import 'temporal-polyfill/global'
import { createCalendar, createViewDay, createViewWeek, createViewMonthGrid, createViewList } from '@schedule-x/calendar/src'
import '../../packages/theme-default/src/calendar.scss'
import './style.css'

const root=document.querySelector('#app')
const embed=location.pathname==='/embed'
const roles={admin:'Администратор',tutor:'Репетитор',student:'Ученик'}
const statuses={scheduled:'Запланировано',completed:'Проведено',cancelled:'Отменено'}
const CACHE='calendar-ops-snapshot-v1'
let account=null, lessons=[], users=[], calendar=null, offline=false, view='calendar', selectedTutor='', authMode='login'
const el=(tag,attrs={},...children)=>{
  const node=document.createElement(tag)
  for(const [key,value] of Object.entries(attrs)){
    if(key.startsWith('on')) node.addEventListener(key.slice(2),value)
    else if(key==='class') node.className=value
    else if(key==='disabled') node.disabled=value
    else node.setAttribute(key,value)
  }
  for(const child of children.flat()) if(child!==null&&child!==undefined) node.append(child instanceof Node?child:document.createTextNode(String(child)))
  return node
}
const button=(text,handler,kind='secondary',disabled=false)=>el('button',{type:'button',class:kind,onclick:handler,disabled},text)
const field=(label,input)=>el('label',{},el('span',{},label),input)
const input=(name,type='text',attrs={})=>el('input',{name,type,required:'',...attrs})
const select=(name,options,value='')=>{
  const node=el('select',{name,required:''},options.map(([id,label])=>el('option',{value:id},label)));node.value=value;return node
}
function notice(message){const node=document.querySelector('#notice');if(node) node.textContent=message}
async function api(path,method='GET',data){
  const res=await fetch('/api/v1/'+path,{method,headers:{'Content-Type':'application/json','X-Calendar-Client':'1'},credentials:'same-origin',...(data?{body:JSON.stringify(data)}:{})})
  const result=await res.json()
  if(!res.ok) throw Object.assign(new Error(result.error||'Ошибка запроса'),{status:res.status})
  return result
}
function dropCache(){try{localStorage.removeItem(CACHE);localStorage.removeItem(CACHE+'-enabled')}catch{}}
function optedIn(){try{return localStorage.getItem(CACHE+'-enabled')==='1'}catch{return false}}
function snapshot(){if(!offline&&!embed&&optedIn())try{localStorage.setItem(CACHE,JSON.stringify({account,lessons,saved:new Date().toISOString()}))}catch{}}
function dispose(){if(calendar){calendar.destroy();calendar=null}}
function brand(){return el('div',{class:'brand'},el('span',{class:'mark','aria-hidden':'true'},'✳'),el('span',{},'calendar',el('b',{},'.ops')))}
function loginPage(){
  dispose();root.replaceChildren()
  const form=el('form',{class:'form'})
  const registration=authMode==='register'
  form.append(field('Логин',input('username','text',{autocomplete:'username'})),field('Пароль',input('password','password',{minlength:'12',autocomplete:registration?'new-password':'current-password'})))
  if(registration)form.prepend(field('Имя',input('name')),field('Пригласительный код',input('code')))
  form.append(el('button',{class:'primary',type:'submit'},registration?'Создать аккаунт':'Войти'))
  form.addEventListener('submit',async e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(form));await api(registration?'register':'login','POST',data);dropCache();view='calendar';selectedTutor='';await refresh()}catch(error){notice(error.message)}})
  root.append(el('main',{class:'login'},el('section',{class:'hero'},brand(),el('div',{class:'hero-art','aria-hidden':'true'},'✳',el('span',{},'◉')),el('h1',{},'Время — в порядке.'),el('p',{},'Единое пространство для занятий, репетиторов и учеников.')),el('section',{class:'auth'},el('div',{class:'auth-inner'},el('div',{class:'eyebrow'},'РАБОЧЕЕ ПРОСТРАНСТВО / 01'),el('h2',{},registration?'Присоединиться':'С возвращением'),el('p',{class:'muted'},registration?'Введите код, полученный у администратора.':'Войдите, чтобы открыть расписание.'),form,button(registration?'Уже есть аккаунт':'У меня есть код',()=>{authMode=registration?'login':'register';loginPage()},'link'),el('p',{id:'notice',role:'status',class:'notice'})))))
}
const fmt=new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'})
const dayFmt=new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'short'})
const timeFmt=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'})
const localInput=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
const visible=()=>lessons.filter(l=>!selectedTutor||l.tutor_id===selectedTutor)
const tutorOptions=()=>users.filter(u=>u.role==='tutor').map(u=>[u.id,u.name])
const studentOptions=()=>users.filter(u=>u.role==='student').map(u=>[u.id,u.name])
function lessonDialog(lesson){
  if(offline||account.role!=='admin'||embed){notice(lesson.title+' · '+fmt.format(new Date(lesson.start))+' · '+statuses[lesson.status]);return}
  if(!tutorOptions().length||!studentOptions().length){notice('Сначала пригласите преподавателя и ученика.');return}
  const dialog=el('dialog',{class:'dialog'})
  const start=lesson?.start||new Date(Date.now()+3600000).toISOString(),end=lesson?.end||new Date(Date.now()+7200000).toISOString()
  const form=el('form',{class:'form'},el('div',{class:'dialog-head'},el('h2',{},lesson?'Изменить занятие':'Новое занятие'),button('×',()=>dialog.close(),'icon')),
    field('Название',input('title','text',{maxlength:'120',value:lesson?.title||''})),
    field('Репетитор',select('tutor_id',tutorOptions(),lesson?.tutor_id||tutorOptions()[0][0])),
    field('Ученик',select('student_id',studentOptions(),lesson?.student_id||studentOptions()[0][0])),
    field('Начало',input('start','datetime-local',{value:localInput(start)})),field('Конец',input('end','datetime-local',{value:localInput(end)})),
    field('Статус',select('status',Object.entries(statuses),lesson?.status||'scheduled')),el('p',{role:'alert',class:'notice'}),el('button',{type:'submit',class:'primary'},'Сохранить'))
  form.addEventListener('submit',async e=>{e.preventDefault();try{
    const data=Object.fromEntries(new FormData(form));data.start=new Date(data.start).toISOString();data.end=new Date(data.end).toISOString()
    await api('lessons'+(lesson?'/'+lesson.id:''),lesson?'PATCH':'POST',data);dialog.close();await refresh()
  }catch(error){form.querySelector('[role=alert]').textContent=error.message}})
  dialog.append(form);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal()
}
function inviteDialog(){
  const dialog=el('dialog',{class:'dialog'})
  const form=el('form',{class:'form'},el('div',{class:'dialog-head'},el('h2',{},'Пригласить'),button('×',()=>dialog.close(),'icon')),field('Роль',select('role',[['tutor','Репетитор'],['student','Ученик']],'tutor')),el('button',{class:'primary',type:'submit'},'Создать одноразовый код'),el('div',{class:'invite-output',role:'status'}))
  form.addEventListener('submit',async e=>{e.preventDefault();const out=form.querySelector('.invite-output');try{const data=await api('invites','POST',Object.fromEntries(new FormData(form)));out.replaceChildren(el('p',{},'Код действует 7 дней. Передайте его лично.'),el('input',{readonly:'',value:data.code,'aria-label':'Пригласительный код'}),button('Копировать',async()=>{try{await navigator.clipboard.writeText(data.code)}catch{out.querySelector('input').select()}}))}catch(error){out.textContent=error.message}})
  dialog.append(form);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal()
}
function card(l){return el('button',{type:'button',class:'lesson '+l.status,onclick:()=>lessonDialog(l)},el('span',{class:'muted'},timeFmt.format(new Date(l.start))+' — '+timeFmt.format(new Date(l.end))),el('strong',{},l.title),el('small',{},l.tutor_name+' · '+l.student_name),el('small',{class:'status'},statuses[l.status]))}
function board(host){
  const groups=new Map()
  for(const lesson of visible()){const d=new Date(lesson.start),key=d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate();if(!groups.has(key))groups.set(key,{date:d,lessons:[]});groups.get(key).lessons.push(lesson)}
  const grid=el('div',{class:'board'})
  for(const {date,lessons:items} of groups.values())grid.append(el('section',{class:'column'},el('h3',{},dayFmt.format(date),el('span',{},items.length)),items.map(card)))
  host.append(groups.size?grid:el('div',{class:'empty'},'Занятий пока нет.'))
}
function render(){
  dispose();root.replaceChildren()
  const admin=account.role==='admin'&&!offline&&!embed
  const sidebar=el('aside',{class:'sidebar'},brand(),el('div',{class:'workspace'},el('span',{class:'avatar'},account.name.slice(0,1).toUpperCase()),el('div',{},el('strong',{},account.name),el('small',{},roles[account.role]))),el('nav',{},button('▦  Календарь',()=>{view='calendar';render()},view==='calendar'?'active':'nav'),button('▤  Доска',()=>{view='board';render()},view==='board'?'active':'nav'),admin?button('♧  Участники',()=>{view='users';render()},view==='users'?'active':'nav'):null),el('div',{class:'sidebar-bottom'},el('span',{class:'muted'},offline?'● Офлайн':'● Подключено'),button(offline?'Закрыть офлайн':'Выйти',async()=>{dropCache();if(!offline)try{await api('logout','POST')}catch(error){notice(error.message);return}account=null;lessons=[];users=[];offline=false;view='calendar';selectedTutor='';loginPage()},'nav')))
  const toolbar=el('div',{class:'toolbar'},el('div',{},el('div',{class:'eyebrow'},'WORKSPACE / '+roles[account.role].toUpperCase()),el('h1',{},view==='users'?'Участники':view==='board'?'Доска занятий':'Расписание')),el('div',{class:'actions'},admin?button('Пригласить',inviteDialog):null,admin?button('+ Занятие',()=>lessonDialog(),'primary'):null))
  const main=el('main',{class:'workspace-main'},toolbar,el('div',{id:'notice',role:'status',class:'notice'},offline?'Офлайн-копия. Изменения недоступны.':'')) 
  if(!embed&&!offline){const toggle=el('input',{type:'checkbox'});toggle.checked=optedIn();toggle.addEventListener('change',()=>{if(toggle.checked){try{localStorage.setItem(CACHE+'-enabled','1');snapshot()}catch{notice('Хранилище недоступно')}}else dropCache()});main.append(el('label',{class:'offline-option'},toggle,'Сохранять расписание на этом устройстве для офлайн-доступа'))}
  if(!embed&&view!=='users')main.append(el('section',{class:'metrics'},...[[visible().filter(l=>l.status==='scheduled').length,'Запланировано'],[visible().filter(l=>l.status==='completed').length,'Проведено'],[visible().filter(l=>l.status==='cancelled').length,'Отменено']].map(([n,label])=>el('article',{},el('span',{class:'muted'},label),el('strong',{},n)))))
  const host=el('section',{class:'surface'})
  if(admin&&view!=='users'){const filter=select('filter',[['','Все репетиторы'],...tutorOptions()],selectedTutor);filter.addEventListener('change',()=>{selectedTutor=filter.value;render()});host.append(el('div',{class:'filter'},field('Репетитор',filter)))}
  main.append(host)
  root.append(el('div',{class:embed?'layout embedded':'layout'},embed?null:sidebar,main))
  if(view==='users'&&admin){host.append(el('div',{class:'people'},users.map(u=>el('article',{},el('span',{class:'avatar'},u.name[0]),el('div',{},el('strong',{},u.name),el('small',{},u.username)),el('span',{class:'pill'},roles[u.role])))));return}
  if(view==='board'){board(host);return}
  const mount=el('div',{class:'calendar-host'});host.append(mount)
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'
  calendar=createCalendar({locale:'ru-RU',timezone:zone,firstDayOfWeek:1,views:[createViewDay(),createViewWeek(),createViewMonthGrid(),createViewList()],defaultView:matchMedia('(max-width: 700px)').matches?'day':'week',
    events:visible().filter(l=>l.status!=='cancelled').map(l=>({id:l.id,title:l.title,start:Temporal.Instant.from(l.start).toZonedDateTimeISO(zone),end:Temporal.Instant.from(l.end).toZonedDateTimeISO(zone),description:l.tutor_name+' · '+l.student_name})),
    callbacks:{onEventClick(event){const lesson=lessons.find(l=>l.id===event.id);if(lesson)lessonDialog(lesson)}}})
  calendar.render(mount)
}
async function refresh(){
  try{
    const me=await api('me');if(account&&account.id!==me.user.id){dropCache();view='calendar';selectedTutor=''};account=me.user
    lessons=(await api('lessons')).lessons
    users=account.role==='admin'&&!embed?(await api('users')).users:[]
    offline=false;snapshot();render()
  }catch(error){
    if(error.status===401){dropCache();account=null;loginPage();return}
    if(!error.status&&!embed){try{const saved=optedIn()&&JSON.parse(localStorage.getItem(CACHE));if(saved?.account){account=saved.account;lessons=saved.lessons;users=[];offline=true;view='board';render();notice('Офлайн-копия от '+fmt.format(new Date(saved.saved))+' · Только чтение');return}}catch{}}
    loginPage();notice(error.message)
  }
}
window.addEventListener('online',()=>refresh())
window.addEventListener('offline',()=>{if(account){offline=true;view='board';render()}})
if('serviceWorker'in navigator&&!embed)navigator.serviceWorker.register('/sw.js').catch(()=>{})
refresh()
