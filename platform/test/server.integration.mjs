import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp, subtractBusy } from '../server.mjs'
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
    const invite=await request('invites','POST',{role,languages:['english','german']},admin.cookie)
    assert.equal(invite.status,201)
    const payload={username,name:username,password:'test-password-long',code:invite.data.code,role:'admin'}
    const result=await request('register','POST',payload)
    assert.equal(result.status,200)
    assert.equal(result.data.user.role,role)
    assert.equal((await request('register','POST',{...payload,username:username+'2'})).status,400)
    return result
  }
  const tutor=await register('tutor','tutor1'), student=await register('student','student1'), other=await register('student','student2')
  const payload={subject:'english',tutor_id:tutor.data.user.id,student_id:student.data.user.id,start:'2026-12-01T10:00:00.000Z',end:'2026-12-01T11:00:00.000Z'}
  const lesson=await request('lessons','POST',payload,admin.cookie)
  assert.equal(lesson.status,201)
  assert.equal((await request('lessons','POST',payload,admin.cookie)).status,409)
  assert.equal(lesson.data.lesson.status,'tentative')
  assert.equal(lesson.data.lesson.lesson_type,'regular')
  assert.equal(lesson.data.lesson.payment_status,'unpaid')
  const lessonPath='lessons/'+lesson.data.lesson.id
  assert.equal((await request(lessonPath,'PATCH',{payment_status:'paid'},student.cookie)).status,403)
  const paid=await request(lessonPath,'PATCH',{payment_status:'paid',receipt_received:1},tutor.cookie)
  assert.equal(paid.status,200)
  assert.equal(paid.data.lesson.payment_status,'paid')
  assert.equal(paid.data.lesson.receipt_received,1)
  assert.equal((await request(lessonPath,'PATCH',{student_id:other.data.user.id},admin.cookie)).status,409)
  assert.equal((await request(lessonPath,'PATCH',{payment_status:'invalid'},admin.cookie)).status,400)
  const reset=await request(lessonPath,'PATCH',{payment_status:'unpaid',receipt_received:0},admin.cookie)
  assert.equal(reset.data.lesson.payment_status,'unpaid')
  const window={start:'2026-12-01T09:00:00.000Z',end:'2026-12-01T12:00:00.000Z'}
  assert.equal((await request('availability','POST',window,admin.cookie)).status,403)
  const slot=await request('availability','POST',window,tutor.cookie)
  assert.equal(slot.status,201)
  assert.equal((await request('availability','POST',window,tutor.cookie)).status,409)
  assert.equal((await request('availability','GET',undefined,student.cookie)).status,403)
  const availability=await request('availability','GET',undefined,admin.cookie)
  assert.equal(availability.data.free.length,2)
  assert.equal(availability.data.free[0].end,payload.start)
  assert.equal(availability.data.free[1].start,payload.end)
  assert.equal((await request('availability/'+slot.data.slot.id,'PATCH',{end:'2026-12-01T13:00:00.000Z'},tutor.cookie)).status,200)
  assert.equal((await request('availability/'+slot.data.slot.id,'DELETE',undefined,admin.cookie)).status,403)
  assert.equal((await request('availability/'+slot.data.slot.id,'DELETE',undefined,tutor.cookie)).status,200)
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
  const next={...payload,student_id:other.data.user.id,start:'2026-12-01T11:00:00.000Z',end:'2026-12-01T12:00:00.000Z',status:'confirmed'}
  assert.equal((await request('lessons','POST',next,tutor.cookie)).status,201)
  const trial=await request('lessons','POST',{...payload,start:'2026-12-01T12:00:00.000Z',end:undefined,lesson_type:'trial'},tutor.cookie)
  assert.equal(trial.status,201)
  assert.equal(trial.data.lesson.end,'2026-12-01T13:00:00.000Z')
  const normal=await request('lessons','POST',{...payload,start:'2026-12-01T13:00:00.000Z',end:undefined},tutor.cookie)
  assert.equal(normal.status,201)
  assert.equal(normal.data.lesson.end,'2026-12-01T14:00:00.000Z')
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
  const old=migrated.prepare("SELECT * FROM lessons WHERE id='old'").get()
  assert.equal(old.status,'confirmed')
  assert.equal(old.lesson_type,'regular')
  assert.equal(old.payment_status,'unpaid')
  assert.equal(old.receipt_received,0)
  assert.equal(migrated.prepare("SELECT student_id FROM tutor_students WHERE tutor_id='t'").get().student_id,'s')
  migrated.close()
})

test('availability subtraction handles adjacent, overlapping and unrelated bookings',()=>{
  const slot={tutor_id:'a',start:'2026-12-01T09:00:00.000Z',end:'2026-12-01T14:00:00.000Z'}
  const busy=[{...slot,start:'2026-12-01T10:00:00.000Z',end:'2026-12-01T11:00:00.000Z'},{...slot,start:'2026-12-01T10:30:00.000Z',end:'2026-12-01T12:00:00.000Z'},{...slot,tutor_id:'b'}]
  assert.deepEqual(subtractBusy([slot],busy),[{...slot,end:'2026-12-01T10:00:00.000Z'},{...slot,start:'2026-12-01T12:00:00.000Z'}])
})

test('guest student, private schedule link and single-use account activation',async t=>{
  const server=createApp({dbPath:':memory:',adminUser:'owner',adminPassword:'abcdef'})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const origin='http://127.0.0.1:'+server.address().port
  const req=async(path,method='GET',body,cookie='')=>{const res=await fetch(origin+'/api/v1/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Calendar-Client':'1',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]}}
  assert.equal((await req('config')).data.minPassword,6)
  const admin=await req('login','POST',{username:'owner',password:'abcdef'})
  assert.equal(admin.status,200)
  const invite=await req('invites','POST',{role:'tutor',languages:['english']},admin.cookie)
  const tutor=await req('register','POST',{username:'teacher',name:'Teacher',password:'abcdef',code:invite.data.code})
  assert.equal(invite.data.code.length,6)
  assert.equal((await req('students','POST',{name:'Forbidden'},tutor.cookie)).status,403)
  const guest=await req('students','POST',{name:'Guest',subject:'english',description:'Цели и уровень'},admin.cookie)
  assert.equal(guest.status,201)
  const id=guest.data.student.id, path='students/'+id+'/access'
  assert.equal(guest.data.student.subject,'english')
  assert.equal(guest.data.student.description,'Цели и уровень')
  assert.deepEqual(tutor.data.user.languages,['english'])
  assert.equal((await req('students/available','GET',undefined,tutor.cookie)).status,403)
  assert.equal((await req('assignments','POST',{student_id:id},tutor.cookie)).status,403)
  assert.equal((await req('assignments','POST',{student_id:id,tutor_id:tutor.data.user.id},admin.cookie)).status,201)
  assert.equal((await req('students/available','GET',undefined,admin.cookie)).data.students.length,0)
  assert.equal((await req('students','GET',undefined,tutor.cookie)).data.students[0].description,'Цели и уровень')
  assert.equal((await req('tutors/'+tutor.data.user.id,'PATCH',{languages:['german']},tutor.cookie)).status,403)
  assert.equal((await req('students','GET',undefined,tutor.cookie)).data.students[0].subject,'english')
  assert.equal((await req('students/'+id,'PATCH',{subject:'spanish'},tutor.cookie)).status,403)
  assert.equal((await req(path,'POST',{kind:'share'},tutor.cookie)).status,403)
  assert.equal((await req('lessons','POST',{subject:'german',student_id:id,start:'2026-12-01T10:00:00Z'},tutor.cookie)).status,400)
  const lesson=await req('lessons','POST',{subject:'english',student_id:id,start:'2026-12-01T10:00:00Z',payment_status:'paid'},tutor.cookie)
  assert.equal(lesson.status,201)
  assert.equal((await req('students/'+id,'PATCH',{subject:'spanish',description:'Обновлено'},admin.cookie)).status,200)
  const share=await req(path,'POST',{kind:'share'},admin.cookie)
  const schedule=await req('shared-schedule','POST',{code:share.data.code})
  assert.equal(schedule.data.lessons.length,1)
  assert.equal(schedule.data.lessons[0].payment_status,undefined)
  assert.equal(schedule.data.lessons[0].subject,'english')
  assert.equal(schedule.data.student.description,undefined)
  assert.equal((await req(path,'DELETE',{kind:'share'},admin.cookie)).status,200)
  assert.equal((await req('shared-schedule','POST',{code:share.data.code})).status,404)
  const claim=await req(path,'POST',{kind:'claim'},admin.cookie)
  assert.equal(claim.data.code.length,6)
  const activated=await req('register','POST',{username:'guest-real',password:'abcdef',code:claim.data.code})
  assert.equal(activated.data.user.id,id)
  assert.equal(activated.data.user.description,undefined)
  assert.equal((await req('lessons','GET',undefined,activated.cookie)).data.lessons.length,1)
  assert.equal((await req('register','POST',{username:'another',password:'abcdef',code:claim.data.code})).status,400)
})
