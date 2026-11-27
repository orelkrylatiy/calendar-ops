import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server.mjs'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('role isolation, invite lifecycle, conflicts, audit-safe cancellation and logout',async t=>{
  const server=createApp({dbPath:':memory:',adminUser:'owner',adminPassword:'test-password-long'})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const origin='http://127.0.0.1:'+server.address().port
  async function request(path,method='GET',data,cookie='',headers={}){
    const res=await fetch(origin+'/api/v1/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Calendar-Client':'1',Cookie:cookie,...headers},...(data?{body:JSON.stringify(data)}:{})})
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]}
  }
  assert.equal((await request('lessons')).status,401)
  const admin=await request('login','POST',{username:'owner',password:'test-password-long'})
  assert.equal(admin.status,200)
  assert.equal((await request('invites','POST',{role:'admin'},admin.cookie)).status,400)
  assert.equal((await request('invites','POST',{role:'tutor'},admin.cookie,{Origin:'https://evil.example'})).status,403)
  async function register(role,username){
    const invite=await request('invites','POST',{role},admin.cookie)
    assert.equal(invite.status,201)
    const payload={username,name:username,password:'test-password-long',code:invite.data.code,role:'admin'}
    const result=await request('register','POST',payload)
    assert.equal(result.status,200)
    assert.equal(result.data.user.role,role)
    assert.equal((await request('register','POST',{...payload,username:username+'2'})).status,400)
    return result
  }
  const tutor=await register('tutor','tutor1'), student=await register('student','student1'), other=await register('student','student2')
  const payload={title:'Math',tutor_id:tutor.data.user.id,student_id:student.data.user.id,start:'2026-12-01T10:00:00.000Z',end:'2026-12-01T11:00:00.000Z'}
  const lesson=await request('lessons','POST',payload,admin.cookie)
  assert.equal(lesson.status,201)
  assert.equal((await request('lessons','POST',payload,admin.cookie)).status,409)
  assert.equal(lesson.data.lesson.status,'tentative')
  assert.equal((await request('lessons','POST',payload,tutor.cookie)).status,409)
  assert.equal((await request('lessons','POST',{...payload,student_id:other.data.user.id},tutor.cookie)).status,403)
  assert.equal((await request('students','GET',undefined,tutor.cookie)).data.students.length,1)
  assert.equal((await request('students','GET',undefined,student.cookie)).status,403)
  const confirmed=await request('lessons/'+lesson.data.lesson.id,'PATCH',{status:'confirmed'},tutor.cookie)
  assert.equal(confirmed.status,200)
  assert.equal(confirmed.data.lesson.status,'confirmed')
  assert.equal((await request('lessons/'+lesson.data.lesson.id,'PATCH',{status:'invalid'},admin.cookie)).status,400)
  assert.equal((await request('users','GET',undefined,student.cookie)).status,403)
  assert.equal((await request('lessons','GET',undefined,tutor.cookie)).data.lessons.length,1)
  assert.equal((await request('lessons','GET',undefined,student.cookie)).data.lessons.length,1)
  assert.equal((await request('lessons','GET',undefined,other.cookie)).data.lessons.length,0)
  assert.equal((await request('lessons/'+lesson.data.lesson.id,'PATCH',{status:'cancelled'},other.cookie)).status,403)
  assert.equal((await request('lessons/'+lesson.data.lesson.id,'PATCH',{status:'cancelled'},admin.cookie)).status,200)
  assert.equal((await request('lessons','POST',payload,admin.cookie)).status,201)
  assert.equal((await request('assignments','POST',{tutor_id:tutor.data.user.id,student_id:other.data.user.id},tutor.cookie)).status,403)
  assert.equal((await request('assignments','POST',{tutor_id:tutor.data.user.id,student_id:other.data.user.id},admin.cookie)).status,201)
  const next={...payload,student_id:other.data.user.id,start:'2026-12-01T11:00:00.000Z',end:'2026-12-01T12:00:00.000Z',status:'no_show'}
  assert.equal((await request('lessons','POST',next,tutor.cookie)).status,201)
  assert.equal((await request('students','GET',undefined,tutor.cookie)).data.students.length,2)
  assert.equal((await request('lessons','GET',undefined,other.cookie)).data.lessons.length,1)
  assert.equal((await request('logout','POST',undefined,student.cookie)).status,200)
  assert.equal((await request('me','GET',undefined,student.cookie)).status,401)
})

test('legacy scheduled lessons migrate to confirmed, preserving IDs and tutor relationships',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'calendar-ops-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const dbPath=join(dir,'legacy.sqlite')
  const db=new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','tutor','student')), password TEXT NOT NULL);
    INSERT INTO users VALUES('a','owner','Admin','admin','unused'),('t','tutor','Tutor','tutor','unused'),('s','student','Student','student','unused');
    CREATE TABLE lessons(id TEXT PRIMARY KEY, title TEXT NOT NULL, tutor_id TEXT NOT NULL REFERENCES users(id), student_id TEXT NOT NULL REFERENCES users(id), start TEXT NOT NULL, end TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled','completed','cancelled')), CHECK(start<end));
    INSERT INTO lessons VALUES('old','Math','t','s','2026-12-01T10:00:00.000Z','2026-12-01T11:00:00.000Z','scheduled');`)
  db.close()
  const server=createApp({dbPath})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  await new Promise(resolve=>server.close(resolve))
  const migrated=new DatabaseSync(dbPath)
  assert.equal(migrated.prepare("SELECT status FROM lessons WHERE id='old'").get().status,'confirmed')
  assert.equal(migrated.prepare("SELECT student_id FROM tutor_students WHERE tutor_id='t'").get().student_id,'s')
  migrated.close()
})
