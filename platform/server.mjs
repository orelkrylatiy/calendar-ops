import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const passwordHash = password => {
  const salt = randomBytes(16).toString('hex')
  return salt + ':' + scryptSync(password, salt, 64).toString('hex')
}
const validPassword = (password, stored) => {
  const [salt, digest] = stored.split(':')
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex'))
}
const username = value => {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[a-z0-9._@+-]{3,80}$/.test(name)) fail(400, 'Логин: 3–80 латинских символов')
  return name
}
const password = value => {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'Пароль: 12–128 символов')
  return value
}
const clean = (value, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, 'Некорректное поле')
  return value.trim()
}
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400, 'Нужна дата UTC ISO 8601')
  return new Date(value).toISOString()
}
const publicUser = ({id, username, name, role}) => ({id, username, name, role})
const json = (res, status, value) => {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'})
  res.end(JSON.stringify(value))
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'Требуется JSON')
  let size = 0
  const parts = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16384) fail(413,'Запрос слишком большой')
    parts.push(chunk)
  }
  try {
    const data = JSON.parse(Buffer.concat(parts).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    return data
  } catch { fail(400,'Некорректный JSON') }
}
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.woff2':'font/woff2'}

export function createApp({dbPath=process.env.CALENDAR_DB || resolve(here,'data/calendar.sqlite'), adminUser=process.env.CALENDAR_ADMIN_USER, adminPassword=process.env.CALENDAR_ADMIN_PASSWORD, secure=process.env.CALENDAR_SECURE_COOKIE==='1', origin=process.env.CALENDAR_ORIGIN, staticDir=resolve(here,'dist')}={}) {
  if(dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)),{recursive:true,mode:0o700})
  const db = new DatabaseSync(dbPath)
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','tutor','student')), password TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('tutor','student')), expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY, title TEXT NOT NULL, tutor_id TEXT NOT NULL REFERENCES users(id), student_id TEXT NOT NULL REFERENCES users(id), start TEXT NOT NULL, end TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled','completed','cancelled')), CHECK(start<end));
  CREATE INDEX IF NOT EXISTS lesson_tutor ON lessons(tutor_id,start,end);
  CREATE INDEX IF NOT EXISTS lesson_student ON lessons(student_id,start,end);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, lesson_id TEXT NOT NULL, before TEXT, after TEXT, created TEXT NOT NULL);
  `)
  const get = (sql,...args) => db.prepare(sql).get(...args)
  const all = (sql,...args) => db.prepare(sql).all(...args)
  const run = (sql,...args) => db.prepare(sql).run(...args)
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE')
    try {const value=fn();db.exec('COMMIT');return value}
    catch(e){db.exec('ROLLBACK');throw e}
  }
  if (!get("SELECT id FROM users WHERE role='admin' LIMIT 1")) {
    if (!adminUser || !adminPassword) {db.close();throw new Error('Set CALENDAR_ADMIN_USER and CALENDAR_ADMIN_PASSWORD (12+ characters) for first start')}
    run('INSERT INTO users VALUES(?,?,?,?,?)',randomUUID(),username(adminUser),'Администратор','admin',passwordHash(password(adminPassword)))
  }
  const cookie = (value, age) => 'calendar_session='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(secure?'; Secure':'')
  const sessionToken = req => (req.headers.cookie||'').match(/(?:^|;\s*)calendar_session=([A-Za-z0-9_-]+)/)?.[1]
  function user(req) {
    const raw = sessionToken(req)
    const account = raw && get('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>?',hash(raw),Date.now())
    if(!account) fail(401,'Войдите в аккаунт')
    return publicUser(account)
  }
  function admin(account) {if(account.role!=='admin') fail(403,'Недостаточно прав')}
  function login(req,res,account) {
    const raw=token(), old=sessionToken(req)
    if(old) run('DELETE FROM sessions WHERE hash=?',hash(old))
    run('DELETE FROM sessions WHERE expires<=?',Date.now())
    run('INSERT INTO sessions VALUES(?,?,?)',hash(raw),account.id,Date.now()+86400000)
    res.setHeader('Set-Cookie',cookie(raw,86400))
    return json(res,200,{user:publicUser(account)})
  }
  const attempts = new Map()
  function limit(req) {
    const now=Date.now(), ip=req.socket.remoteAddress
    if(attempts.size>2000) for(const [key,val] of attempts) if(val.until<now) attempts.delete(key)
    const old=attempts.get(ip)
    if(old && old.until>now) {if(++old.count>20) fail(429,'Попробуйте позже')}
    else {if(attempts.size>5000) fail(429,'Попробуйте позже');attempts.set(ip,{count:1,until:now+60000})}
  }
  const dummyHash=passwordHash(token())
  const selectLessons='SELECT l.*, t.name AS tutor_name, s.name AS student_name FROM lessons l JOIN users t ON t.id=l.tutor_id JOIN users s ON s.id=l.student_id'
  function saveLesson(account,data,id) {
    admin(account)
    return tx(()=>{
      const previous=id?get('SELECT * FROM lessons WHERE id=?',id):null
      if(id&&!previous) fail(404,'Занятие не найдено')
      const input={...previous,...data}
      const title=clean(input.title), tutor=clean(input.tutor_id), student=clean(input.student_id)
      const start=date(input.start), end=date(input.end), status=input.status||'scheduled'
      if(start>=end || Date.parse(end)-Date.parse(start)>86400000) fail(400,'Проверьте длительность')
      if(!['scheduled','completed','cancelled'].includes(status)) fail(400,'Некорректный статус')
      if(get('SELECT role FROM users WHERE id=?',tutor)?.role!=='tutor'||get('SELECT role FROM users WHERE id=?',student)?.role!=='student') fail(400,'Выберите преподавателя и ученика')
      if(status!=='cancelled'&&get("SELECT id FROM lessons WHERE status!='cancelled' AND id!=? AND (tutor_id=? OR student_id=?) AND start<? AND end>?",id||'',tutor,student,end,start)) fail(409,'В это время преподаватель или ученик уже занят')
      const lessonId=id||randomUUID()
      if(id) run('UPDATE lessons SET title=?,tutor_id=?,student_id=?,start=?,end=?,status=? WHERE id=?',title,tutor,student,start,end,status,id)
      else run('INSERT INTO lessons VALUES(?,?,?,?,?,?,?)',lessonId,title,tutor,student,start,end,status)
      const lesson=get('SELECT * FROM lessons WHERE id=?',lessonId)
      run('INSERT INTO audit(actor,action,lesson_id,before,after,created) VALUES(?,?,?,?,?,?)',account.id,id?'updated':'created',lessonId,previous?JSON.stringify(previous):null,JSON.stringify(lesson),new Date().toISOString())
      return lesson
    })
  }
  async function handle(req,res) {
    const url=new URL(req.url,'http://localhost'), path=url.pathname
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('Referrer-Policy','no-referrer')
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
    if(!path.startsWith('/api/')) {
      if(!['GET','HEAD'].includes(req.method)) fail(405,'Метод недоступен')
      const root=resolve(staticDir)
      const file=resolve(root,'.'+(path==='/'||path==='/embed'?'/index.html':decodeURIComponent(path)))
      if(!file.startsWith(root+sep)) fail(404,'Не найдено')
      try {
        if(!statSync(file).isFile()) fail(404,'Не найдено')
        res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':path.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache'})
        return res.end(req.method==='HEAD'?undefined:readFileSync(file))
      } catch(e) {if(e.status) throw e;fail(404,'Сначала соберите приложение: npm run build')}
    }
    const method=req.method
    if(!['GET','HEAD'].includes(method)) {
      const expected=origin||(secure?'https://':'http://')+req.headers.host
      if(req.headers['x-calendar-client']!=='1'||req.headers.origin!==expected) fail(403,'Недопустимый источник запроса')
    }
    if(method==='POST'&&path==='/api/v1/login'){
      limit(req);const input=await body(req)
      const account=get('SELECT * FROM users WHERE username=?',username(input.username))
      const ok=validPassword(password(input.password),account?.password||dummyHash)
      if(!account||!ok) fail(401,'Неверный логин или пароль')
      return login(req,res,account)
    }
    if(method==='POST'&&path==='/api/v1/register'){
      limit(req);const input=await body(req)
      const account=tx(()=>{
        const code=hash(clean(input.code,100)), invite=get('SELECT * FROM invites WHERE hash=? AND used=0 AND expires>?',code,Date.now())
        if(!invite) fail(400,'Код недействителен или уже использован')
        const name=clean(input.name), handle=username(input.username), pass=passwordHash(password(input.password))
        if(get('SELECT id FROM users WHERE username=?',handle)) fail(409,'Логин занят')
        const id=randomUUID()
        run('INSERT INTO users VALUES(?,?,?,?,?)',id,handle,name,invite.role,pass)
        run('UPDATE invites SET used=1 WHERE hash=?',code)
        return get('SELECT * FROM users WHERE id=?',id)
      })
      return login(req,res,account)
    }
    const account=user(req)
    if(method==='POST'&&path==='/api/v1/logout'){
      run('DELETE FROM sessions WHERE hash=?',hash(sessionToken(req)));res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true})
    }
    if(method==='GET'&&path==='/api/v1/me') return json(res,200,{user:account})
    if(method==='GET'&&path==='/api/v1/users'){
      admin(account);return json(res,200,{users:all('SELECT id,username,name,role FROM users ORDER BY name')})
    }
    if(method==='POST'&&path==='/api/v1/invites'){
      admin(account);const {role}=await body(req)
      if(!['tutor','student'].includes(role)) fail(400,'Некорректная роль')
      const code=token(),expires=Date.now()+7*86400000
      run('INSERT INTO invites(hash,role,expires) VALUES(?,?,?)',hash(code),role,expires)
      return json(res,201,{code,expires:new Date(expires).toISOString(),role})
    }
    if(method==='GET'&&path==='/api/v1/lessons'){
      const clause=account.role==='admin'?'':account.role==='tutor'?' WHERE l.tutor_id=?':' WHERE l.student_id=?'
      const lessons=all(selectLessons+clause+' ORDER BY l.start',...(clause?[account.id]:[]))
      return json(res,200,{lessons})
    }
    if(method==='POST'&&path==='/api/v1/lessons') return json(res,201,{lesson:saveLesson(account,await body(req))})
    const match=path.match(/^\/api\/v1\/lessons\/([a-f0-9-]{36})$/)
    if(method==='PATCH'&&match) return json(res,200,{lesson:saveLesson(account,await body(req),match[1])})
    fail(404,'Не найдено')
  }
  const server=createServer((req,res)=>handle(req,res).catch(e=>{
    if(!e.status) console.error(e)
    if(!res.headersSent) json(res,e.status||500,{error:e.status?e.message:'Ошибка сервера'})
    else res.end()
  }))
  server.on('close',()=>db.close())
  return server
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  createApp().listen(Number(process.env.PORT||4173),process.env.HOST||'127.0.0.1',()=>console.log('Calendar Ops listening'))
}
