import 'temporal-polyfill/global'
import { createCalendar, createViewDay, createViewWeek, createViewMonthGrid, createViewList } from '@schedule-x/calendar/src'
import { createCurrentTimePlugin } from '@schedule-x/current-time/src'
import { createCalendarControlsPlugin } from '@schedule-x/calendar-controls/src'
import '../../packages/theme-default/src/calendar.scss'
import './style.css'

const root=document.querySelector('#app')
const embed=location.pathname==='/embed'
const shared=location.pathname==='/schedule'
const fullscreen=location.pathname==='/calendar'
let theme=localStorage.getItem('calendar-ops-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')
let minPassword=6, availabilityOpen=false, filtersOpen=false, suppressClickUntil=0
const applyTheme=()=>{document.documentElement.dataset.theme=theme}
applyTheme()
const themeButton=()=>button(theme==='dark'?'☀ Светлая':'☾ Тёмная',()=>{theme=theme==='dark'?'light':'dark';localStorage.setItem('calendar-ops-theme',theme);applyTheme();account?render():loginPage()},'secondary')
const roles={admin:'Администратор',tutor:'Репетитор',student:'Ученик'}
const statuses={tentative:'Предварительно',confirmed:'Подтверждено',completed:'Проведено',cancelled:'Отменено',no_show:'Неявка'}
const statusColors={tentative:['#64748b','#f8fafc','#334155'],confirmed:['#2563eb','#dbeafe','#1e3a8a'],completed:['#15803d','#dcfce7','#14532d'],cancelled:['#64748b','#f1f5f9','#475569'],no_show:['#b45309','#fef3c7','#78350f']}
const statusOf=l=>l.status==='scheduled'?'confirmed':l.status
const lessonTypes={regular:'Обычное',trial:'Пробное'}
const paymentStatuses={unpaid:'Не оплачено',paid:'Оплачено'}
const typeOf=l=>l.lesson_type==='trial'?'trial':'regular'
const paymentOf=l=>l.payment_status==='paid'?'paid':'unpaid'
const durationOf=l=>Math.round((Date.parse(l.end)-Date.parse(l.start))/60000)
const canEdit=()=>!!account&&['admin','tutor'].includes(account.role)&&!offline&&!embed&&!shared
const resetFilters=()=>{selectedTutor='';selectedStudent='';selectedStatus='';selectedPayment='';selectedType='';selectedDate=null;availabilityMode=false;availabilityOpen=false;filtersOpen=false;calendarView=null}
const CACHE='calendar-ops-snapshot-v1'
let account=null, lessons=[], users=[], calendar=null, offline=false, view='calendar', selectedTutor='', selectedStudent='', selectedStatus='', selectedPayment='', selectedType='', slots=[], freeSlots=[], availabilityMode=false, selectedDate=null, calendarView=null, controls=null, authMode='login'
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
let noticeTimer
function notice(message){const node=document.querySelector('#notice');if(node){node.textContent=message;node.classList.toggle('toast',!!account);clearTimeout(noticeTimer);if(account&&message)noticeTimer=setTimeout(()=>{node.textContent='';node.classList.remove('toast')},6500)}}
function openDialog(dialog){
  const isOutside=e=>{const r=dialog.getBoundingClientRect();return e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)}
  let outside=false
  dialog.addEventListener('pointerdown',e=>{outside=isOutside(e)})
  dialog.addEventListener('click',e=>{if(outside&&isOutside(e))dialog.close();outside=false})
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal()
}
const clock=()=>el('span',{class:'live-clock','aria-label':'Текущее время'},new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}))
setInterval(()=>{document.querySelectorAll('.live-clock').forEach(n=>{n.textContent=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'})})},1000)
async function api(path,method='GET',data){
  const res=await fetch('/api/v1/'+path,{method,headers:{'Content-Type':'application/json','X-Calendar-Client':'1'},credentials:'same-origin',...(data?{body:JSON.stringify(data)}:{})})
  const result=await res.json()
  if(!res.ok) throw Object.assign(new Error(result.error||'Ошибка запроса'),{status:res.status})
  return result
}
function dropCache(){try{localStorage.removeItem(CACHE);localStorage.removeItem(CACHE+'-enabled')}catch{}}
function optedIn(){try{return localStorage.getItem(CACHE+'-enabled')==='1'}catch{return false}}
function snapshot(){if(!offline&&!embed&&!shared&&optedIn())try{localStorage.setItem(CACHE,JSON.stringify({account,lessons,saved:new Date().toISOString()}))}catch{}}
function dispose(){if(calendar){selectedDate=controls?.getDate()||selectedDate;calendarView=controls?.getView()||calendarView;calendar.destroy();calendar=null;controls=null}}
function brand(){return el('div',{class:'brand'},el('span',{class:'mark','aria-hidden':'true'},'✳'),el('span',{},'calendar',el('b',{},'.ops')))}
function loginPage(){
  dispose();root.replaceChildren()
  const form=el('form',{class:'form'})
  const registration=authMode==='register'
  form.append(field('Логин',input('username','text',{autocomplete:'username'})),field('Пароль',input('password','password',{minlength:String(minPassword),autocomplete:registration?'new-password':'current-password'})))
  if(registration)form.prepend(field('Имя',input('name')),field('Пригласительный код',input('code','text',{value:new URLSearchParams(location.hash.slice(1)).get('invite')||''})))
  form.append(el('button',{class:'primary',type:'submit'},registration?'Создать аккаунт':'Войти'))
  form.addEventListener('submit',async e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(form));await api(registration?'register':'login','POST',data);if(location.hash)history.replaceState(null,'',location.pathname+location.search);dropCache();dispose();view='calendar';resetFilters();await refresh()}catch(error){notice(error.message)}})
  root.append(el('main',{class:'login compact-login'},el('section',{class:'auth'},el('div',{class:'auth-inner'},brand(),themeButton(),el('h2',{},registration?'Присоединиться':'Войти в календарь'),el('p',{class:'muted'},registration?'Введите код и придумайте пароль.':'Расписание занятий и свободное время.'),form,button(registration?'Уже есть аккаунт':'У меня есть код',()=>{authMode=registration?'login':'register';loginPage()},'link'),el('p',{id:'notice',role:'status',class:'notice'})))))
}
const fmt=new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'})
const dayFmt=new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'short'})
const timeFmt=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'})
const localInput=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
const visible=(withStatus=true)=>lessons.filter(l=>(!selectedTutor||l.tutor_id===selectedTutor)&&(!selectedStudent||l.student_id===selectedStudent)&&(!withStatus||!selectedStatus||statusOf(l)===selectedStatus)&&(!selectedPayment||paymentOf(l)===selectedPayment)&&(!selectedType||typeOf(l)===selectedType))
const tutorOptions=()=>account?.role==='tutor'?[[account.id,account.name]]:users.filter(u=>u.role==='tutor').map(u=>[u.id,u.name])
const studentOptions=()=>{
  const roster=new Map(users.filter(u=>u.role==='student').map(u=>[u.id,u.name]))
  for(const l of lessons)if(!roster.has(l.student_id))roster.set(l.student_id,l.student_name)
  return [...roster].sort((a,b)=>a[1].localeCompare(b[1],'ru'))
}
function statusBadge(status){return el('span',{class:'status-badge status-'+status},el('span',{class:'status-dot','aria-hidden':'true'}),statuses[status])}
function paymentBadge(lesson){return el('span',{class:'payment-badge payment-'+paymentOf(lesson)},paymentOf(lesson)==='paid'?'✓':'○',paymentStatuses[paymentOf(lesson)])}
function typeBadge(lesson){return el('span',{class:'type-badge type-'+typeOf(lesson)},lessonTypes[typeOf(lesson)]+' · '+durationOf(lesson)+' мин')}
function lessonDetails(lesson){
  const dialog=el('dialog',{class:'dialog details-dialog'})
  dialog.append(el('div',{class:'dialog-head'},el('h2',{},lesson.title),button('×',()=>dialog.close(),'icon')),el('div',{class:'lesson-badges'},statusBadge(statusOf(lesson)),typeBadge(lesson),shared?null:paymentBadge(lesson)),
    el('dl',{class:'detail-grid'},el('dt',{},'Дата и время'),el('dd',{},fmt.format(new Date(lesson.start))+' — '+timeFmt.format(new Date(lesson.end))),el('dt',{},'Репетитор'),el('dd',{},lesson.tutor_name),el('dt',{},'Ученик'),el('dd',{},lesson.student_name),shared?null:el('dt',{},'Чек'),shared?null:el('dd',{},lesson.receipt_received===1?'Получен':'Не отмечен')),button('Закрыть',()=>dialog.close(),'secondary'))
  openDialog(dialog)
}
function assignmentDialog(){
  if(!tutorOptions().length||!studentOptions().length){notice('Сначала пригласите преподавателя и ученика.');return}
  const dialog=el('dialog',{class:'dialog'})
  const form=el('form',{class:'form'},el('div',{class:'dialog-head'},el('h2',{},'Закрепить ученика'),button('×',()=>dialog.close(),'icon')),field('Репетитор',select('tutor_id',tutorOptions(),selectedTutor||tutorOptions()[0][0])),field('Ученик',select('student_id',studentOptions(),selectedStudent||studentOptions()[0][0])),el('p',{class:'muted'},'Репетитор сможет создавать занятия с этим учеником.'),el('p',{role:'alert',class:'notice'}),el('button',{type:'submit',class:'primary'},'Закрепить'))
  form.addEventListener('submit',async e=>{e.preventDefault();try{await api('assignments','POST',Object.fromEntries(new FormData(form)));dialog.close();notice('Ученик закреплён за репетитором.')}catch(error){form.querySelector('[role=alert]').textContent=error.message}})
  dialog.append(form);openDialog(dialog)
}
function lessonDialog(lesson,slot,slotEnd,exact=false){
  if(!canEdit()){if(lesson)lessonDetails(lesson);return}
  if(!tutorOptions().length){notice('Сначала добавьте репетитора в разделе «Участники».');return}
  if(!studentOptions().length){studentDialog();return}
  const dialog=el('dialog',{class:'dialog'})
  const next=slot!=null?new Date(slot):new Date(Math.ceil((Date.now()+3600000)/1800000)*1800000)
  const start=lesson?.start||next.toISOString(),end=lesson?.end||new Date(exact&&slotEnd?Date.parse(slotEnd):Math.min(next.getTime()+3600000,slotEnd?Date.parse(slotEnd):Infinity)).toISOString()
  const form=el('form',{class:'form'},el('div',{class:'dialog-head'},el('h2',{},lesson?'Изменить занятие':'Новое занятие'),button('×',()=>dialog.close(),'icon')),
    field('Название',input('title','text',{maxlength:'120',value:lesson?.title||''})),
    field('Репетитор',select('tutor_id',tutorOptions(),lesson?.tutor_id||selectedTutor||tutorOptions()[0][0])),
    field('Ученик',select('student_id',studentOptions(),lesson?.student_id||selectedStudent||studentOptions()[0][0])),
    field('Тип занятия',select('lesson_type',Object.entries(lessonTypes),lesson?typeOf(lesson):'regular')),
    field('Продолжительность',select('duration_preset',[['30','30 минут'],['45','45 минут'],['60','60 минут'],['90','90 минут'],['custom','Своя продолжительность']],lesson&&![30,45,60,90].includes(durationOf(lesson))?'custom':String(lesson?durationOf(lesson):[30,45,60,90].includes((Date.parse(end)-Date.parse(start))/60000)?(Date.parse(end)-Date.parse(start))/60000:'custom'))),
    el('div',{class:'date-fields'},field('Начало',input('start','datetime-local',{value:localInput(start)})),field('Конец',input('end','datetime-local',{value:localInput(end)}))),
    field('Статус',select('status',Object.entries(statuses),lesson?statusOf(lesson):'tentative')),el('p',{class:'form-hint'},'Предварительное занятие резервирует время.'),
    el('fieldset',{class:'payment-panel'},el('legend',{},'Оплата'),field('Статус оплаты',select('payment_status',Object.entries(paymentStatuses),lesson?paymentOf(lesson):'unpaid')),el('label',{class:'receipt-option'},el('input',{type:'checkbox',name:'receipt_received',value:'1',...(lesson?.receipt_received===1?{checked:''}:{})}),'Чек получен'),el('p',{class:'form-hint'},'Ручная отметка, не банковское подтверждение.')),
    el('p',{role:'alert',class:'notice'}),el('button',{type:'submit',class:'primary'},'Сохранить'))
  const startField=form.elements.start,endField=form.elements.end,typeField=form.elements.lesson_type,preset=form.elements.duration_preset
  let duration=new Date(end).getTime()-new Date(start).getTime()
  const syncEnd=()=>{if(startField.value)endField.value=localInput(new Date(new Date(startField.value).getTime()+duration))}
  const syncPreset=()=>{const minutes=duration/60000;preset.value=[30,45,60,90].includes(minutes)?String(minutes):'custom'}
  startField.addEventListener('change',syncEnd)
  endField.addEventListener('change',()=>{const diff=new Date(endField.value)-new Date(startField.value);if(diff>0){duration=diff;syncPreset()}})
  typeField.addEventListener('change',()=>{duration=(typeField.value==='trial'?30:60)*60000;syncPreset();syncEnd()})
  preset.addEventListener('change',()=>{if(preset.value!=='custom'){duration=Number(preset.value)*60000;syncEnd()}else endField.focus()})
  form.addEventListener('submit',async e=>{e.preventDefault();const submit=form.querySelector('button[type=submit]');submit.disabled=true;try{
    const data=Object.fromEntries(new FormData(form));delete data.duration_preset;data.receipt_received=form.elements.receipt_received.checked?1:0;data.start=new Date(data.start).toISOString();data.end=new Date(data.end).toISOString()
    if(lesson&&data.payment_status===paymentOf(lesson))delete data.payment_status
    if(lesson&&data.receipt_received===(lesson.receipt_received??0))delete data.receipt_received
    await api('lessons'+(lesson?'/'+lesson.id:''),lesson?'PATCH':'POST',data);dialog.close();await refresh()
  }catch(error){form.querySelector('[role=alert]').textContent=error.message}finally{submit.disabled=false}})
  dialog.append(form);openDialog(dialog)
}
const canAvailability=()=>account?.role==='tutor'&&!offline&&!embed
const showAvailability=()=>!embed&&!offline&&(account?.role==='tutor'||(account?.role==='admin'&&!!selectedTutor))
function slotDialog(slot=null,at=null,until=null){
  if(!canAvailability())return
  const dialog=el('dialog',{class:'dialog'})
  const rounded=new Date(at??Date.now());rounded.setMinutes(0,0,0);if(at===null&&rounded.getTime()<Date.now())rounded.setHours(rounded.getHours()+1)
  const start=slot?.start||new Date(until?at:rounded).toISOString()
  const end=slot?.end||new Date(until??Date.parse(start)+3600000).toISOString()
  const form=el('form',{class:'form'},el('div',{class:'dialog-head'},el('h2',{},slot?'Изменить доступность':'Добавить свободное время'),button('×',()=>dialog.close(),'icon')),
    field('Начало',input('start','datetime-local',{value:localInput(start)})),field('Конец',input('end','datetime-local',{value:localInput(end)})),el('p',{class:'form-hint'},'Задайте период, когда можете проводить занятия. Записанные уроки автоматически исключаются из свободного времени.'),el('p',{role:'alert',class:'notice'}),el('button',{type:'submit',class:'primary'},'Сохранить доступность'))
  const update=async(method,data)=>{try{await api('availability'+(slot?'/'+slot.id:''),method,data);dialog.close();await refresh()}catch(error){form.querySelector('[role=alert]').textContent=error.message}}
  form.addEventListener('submit',async e=>{e.preventDefault();const submit=form.querySelector('button[type=submit]');submit.disabled=true;try{await update(slot?'PATCH':'POST',{start:new Date(form.elements.start.value).toISOString(),end:new Date(form.elements.end.value).toISOString()})}finally{submit.disabled=false}})
  if(slot)form.append(button('Удалить интервал',()=>update('DELETE'),'secondary'))
  dialog.append(form);openDialog(dialog)
}
function availabilityPanel(host){
  const own=canAvailability()
  const relevant=slots.filter(s=>own||s.tutor_id===selectedTutor)
  const free=freeSlots.filter(s=>own||s.tutor_id===selectedTutor)
  const panel=el('section',{class:'availability-panel'},el('div',{class:'availability-heading'},el('div',{},el('h3',{},'Доступность'),el('p',{class:'muted'},own?'Выберите интервалы, когда готовы проводить занятия.':'Свободные интервалы выбранного репетитора.')),own?button('+ Интервал',()=>slotDialog()):null,button('×',()=>{availabilityOpen=false;availabilityMode=false;render()},'icon')))
  if(own)panel.append(button(availabilityMode?'Режим: доступность (выключить)':'Отмечать свободное время в календаре',()=>{availabilityMode=!availabilityMode;view='calendar';render()},availabilityMode?'primary':'secondary'))
  const list=own?relevant:free
  panel.append(el('div',{class:'availability-list'},list.length?list.map(slot=>el('div',{class:'availability-row'},el('span',{},fmt.format(new Date(slot.start))+' — '+fmt.format(new Date(slot.end))),own?button('Изменить',()=>slotDialog(slot)):button('Назначить',()=>lessonDialog(null,Date.parse(slot.start),slot.end)))):el('p',{class:'muted'},'Нет доступных интервалов.')))
  host.append(panel)
}
function studentDialog(){
  const dialog=el('dialog',{class:'dialog'})
  const tutorSelect=select('tutor_id',[['','Без закрепления'],...tutorOptions()],selectedTutor);tutorSelect.required=false
  const form=el('form',{class:'form'},el('div',{class:'dialog-head'},el('h2',{},'Добавить ученика'),button('×',()=>dialog.close(),'icon')),field('Имя',input('name','text',{maxlength:'120'})),account.role==='admin'?field('Репетитор',tutorSelect):null,el('p',{class:'form-hint'},'Регистрация не нужна. Ученик сразу доступен для записи.'),el('p',{role:'alert',class:'notice'}),el('button',{type:'submit',class:'primary'},'Создать'))
  form.addEventListener('submit',async e=>{e.preventDefault();try{await api('students','POST',Object.fromEntries(new FormData(form)));dialog.close();await refresh();notice('Ученик добавлен')}catch(error){form.querySelector('[role=alert]').textContent=error.message}})
  dialog.append(form);openDialog(dialog)
}
function accessDialog(student){
  const dialog=el('dialog',{class:'dialog'}),out=el('div',{class:'invite-output',role:'status'})
  const issue=async(kind,method='POST')=>{try{
    const data=await api('students/'+student.id+'/access',method,{kind})
    if(method==='DELETE'){out.textContent='Доступ отозван';return}
    const link=location.origin+(kind==='share'?'/schedule#code=':'/#invite=')+encodeURIComponent(data.code)
    const value=el('input',{readonly:'',value:link,'aria-label':'Личная ссылка'})
    out.replaceChildren(el('p',{},kind==='share'?'Личная ссылка действует 30 дней. Любой, у кого она есть, видит расписание.':'Одноразовая ссылка действует 7 дней. Ученик сам задаст логин и пароль.'),value,button('Копировать',async()=>{try{await navigator.clipboard.writeText(link)}catch{value.select()}}))
  }catch(error){out.textContent=error.message}}
  dialog.append(el('div',{class:'dialog-head'},el('h2',{},student.name),button('×',()=>dialog.close(),'icon')),el('div',{class:'form'},button('Личная ссылка на расписание',()=>issue('share'),'primary'),button('Отозвать ссылку',()=>issue('share','DELETE')),student.guest?button('Пригласить создать аккаунт',()=>issue('claim')):null,student.guest?button('Отозвать приглашение',()=>issue('claim','DELETE')):null,out))
  openDialog(dialog)
}
function helpPanel(host){
  host.append(el('section',{class:'help-panel'},el('h2',{},'Как пользоваться календарём'),el('p',{},'Нажмите свободную ячейку или выделите мышью интервал. Правый клик на свободном времени также открывает создание. Нажмите занятие для подробностей. Потяните нижний край события мышью, чтобы изменить окончание.'),el('h3',{},'Репетитор'),el('p',{},'Кнопка «Доступность» открывает интервалы. Включите режим отметки, выделите время, сохраните. Занятые уроками часы автоматически исключаются.'),el('h3',{},'Ученики и оплата'),el('p',{},'Создайте ученика без регистрации, выберите его в занятии, отметьте договорённость и оплату. Администратор выдаёт личную ссылку или приглашение.'),el('h3',{},'Горячие клавиши'),el('p',{},'N — новое занятие, A — доступность, Esc — закрыть диалог. Тема сохраняется на устройстве.')))
}
function inviteDialog(){
  const dialog=el('dialog',{class:'dialog'})
  const form=el('form',{class:'form'},el('div',{class:'dialog-head'},el('h2',{},'Пригласить'),button('×',()=>dialog.close(),'icon')),field('Роль',select('role',[['tutor','Репетитор'],['student','Ученик']],'tutor')),el('button',{class:'primary',type:'submit'},'Создать одноразовый код'),el('div',{class:'invite-output',role:'status'}))
  form.addEventListener('submit',async e=>{e.preventDefault();const out=form.querySelector('.invite-output');try{const data=await api('invites','POST',Object.fromEntries(new FormData(form)));out.replaceChildren(el('p',{},'Код действует 7 дней. Передайте его лично.'),el('input',{readonly:'',value:data.code,'aria-label':'Пригласительный код'}),button('Копировать ссылку',async()=>{try{await navigator.clipboard.writeText(location.origin+'/#invite='+encodeURIComponent(data.code))}catch{out.querySelector('input').select()}}))}catch(error){out.textContent=error.message}})
  dialog.append(form);openDialog(dialog)
}
function card(l){return el('button',{type:'button',class:'lesson status-'+statusOf(l)+' type-'+typeOf(l),onclick:()=>lessonDialog(l)},el('span',{class:'muted'},timeFmt.format(new Date(l.start))+' — '+timeFmt.format(new Date(l.end))),el('strong',{},l.title),el('small',{},l.tutor_name+' · '+l.student_name),el('div',{class:'lesson-badges'},statusBadge(statusOf(l)),typeBadge(l),shared?null:paymentBadge(l),!shared&&l.receipt_received===1?el('span',{class:'receipt-badge'},'Чек ✓'):null))}
function board(host){
  const groups=new Map()
  for(const lesson of visible()){const d=new Date(lesson.start),key=d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate();if(!groups.has(key))groups.set(key,{date:d,lessons:[]});groups.get(key).lessons.push(lesson)}
  const grid=el('div',{class:'board'})
  for(const {date,lessons:items} of groups.values())grid.append(el('section',{class:'column'},el('h3',{},dayFmt.format(date),el('span',{},items.length)),items.map(card)))
  host.append(groups.size?grid:el('div',{class:'empty'},'Занятий пока нет.'))
}
function render(){
  dispose();root.replaceChildren()
  const admin=account.role==='admin'&&!offline&&!embed&&!shared
  const sidebar=el('aside',{class:'sidebar'},brand(),el('div',{class:'workspace'},el('span',{class:'avatar'},account.name.slice(0,1).toUpperCase()),el('div',{},el('strong',{},account.name),el('small',{},roles[account.role]))),el('nav',{},button('▦  Календарь',()=>{view='calendar';render()},view==='calendar'?'active':'nav'),button('▤  Доска',()=>{view='board';render()},view==='board'?'active':'nav'),!shared&&!embed?button('◫  Статистика',()=>{view='stats';render()},view==='stats'?'active':'nav'):null,button('?  Помощь',()=>{view='help';render()},view==='help'?'active':'nav'),(admin||canAvailability())?button('♧  Участники',()=>{view='users';render()},view==='users'?'active':'nav'):null),el('div',{class:'sidebar-bottom'},themeButton(),el('span',{class:'muted'},offline?'● Офлайн':'● Подключено'),button(offline?'Закрыть офлайн':'Выйти',async()=>{dropCache();if(!offline)try{await api('logout','POST')}catch(error){notice(error.message);return}account=null;lessons=[];users=[];slots=[];freeSlots=[];offline=false;dispose();view='calendar';resetFilters();loginPage()},'nav')))
  const toolbar=el('div',{class:'toolbar'},el('div',{class:'workspace-title'},el('h1',{},view==='users'?'Участники':view==='board'?'Доска занятий':view==='stats'?'Статистика':view==='help'?'Помощь':'Расписание'),clock()),el('div',{class:'actions'},!embed&&!shared?button(fullscreen?'↙ В рабочее пространство':'↗ На весь экран',()=>{location.href=fullscreen?'/':'/calendar'}):null,(fullscreen||shared||embed)?themeButton():null,(admin||canAvailability())&&view==='users'?button('+ Ученик',studentDialog,'primary'):null,admin&&view==='users'?button('Пригласить',inviteDialog):null,admin&&view==='users'?button('Закрепить ученика',assignmentDialog):null,canEdit()&&view!=='users'?button('+ Занятие',()=>lessonDialog(),'primary'):null))
  const main=el('main',{class:'workspace-main'},toolbar,el('div',{id:'notice',role:'status',class:'notice'},offline?'Офлайн-копия. Изменения недоступны.':'')) 
  if(view==='help'&&!embed&&!offline&&!shared){const toggle=el('input',{type:'checkbox'});toggle.checked=optedIn();toggle.addEventListener('change',()=>{if(toggle.checked){try{localStorage.setItem(CACHE+'-enabled','1');snapshot()}catch{notice('Хранилище недоступно')}}else dropCache()});main.append(el('label',{class:'offline-option'},toggle,'Сохранять расписание на этом устройстве для офлайн-доступа'))}
  if(!embed&&view==='stats')main.append(el('section',{class:'metrics'},...Object.entries(statuses).map(([status,label])=>el('button',{type:'button',class:'metric status-'+status+(selectedStatus===status?' selected':''),'aria-pressed':String(selectedStatus===status),onclick:()=>{selectedStatus=selectedStatus===status?'':status;render()}},statusBadge(status),el('strong',{},visible(false).filter(l=>statusOf(l)===status).length),el('span',{class:'sr-only'},label)))))
  const host=el('section',{class:'surface'})
  if(['calendar','board'].includes(view)){
    const filters=el('div',{class:'filter'})
    if(admin){const tutor=select('tutor_filter',[['','Все репетиторы'],...tutorOptions()],selectedTutor);tutor.addEventListener('change',()=>{selectedTutor=tutor.value;render()});filters.append(field('Репетитор',tutor))}
    if(account.role!=='student'&&!embed){const student=select('student_filter',[['','Все ученики'],...studentOptions()],selectedStudent);student.addEventListener('change',()=>{selectedStudent=student.value;render()});filters.append(field('Ученик',student))}
    const status=select('status_filter',[['','Все статусы'],...Object.entries(statuses)],selectedStatus);status.addEventListener('change',()=>{selectedStatus=status.value;render()});filters.append(field('Статус',status))
    const type=select('type_filter',[['','Все типы'],...Object.entries(lessonTypes)],selectedType);type.addEventListener('change',()=>{selectedType=type.value;render()});filters.append(field('Тип',type))
    const payment=select('payment_filter',[['','Вся оплата'],...Object.entries(paymentStatuses)],selectedPayment);payment.addEventListener('change',()=>{selectedPayment=payment.value;render()});if(!shared)filters.append(field('Оплата',payment))
    if(selectedTutor||selectedStudent||selectedStatus||selectedPayment||selectedType)filters.append(button('Сбросить',()=>{selectedTutor='';selectedStudent='';selectedStatus='';selectedPayment='';selectedType='';render()},'secondary'))
    const controlsBar=el('div',{class:'calendar-tools'},button(filtersOpen?'Скрыть фильтры':'Фильтры',()=>{filtersOpen=!filtersOpen;render()},'secondary'),!shared&&!embed&&(admin||canAvailability())?button(availabilityOpen?'Скрыть доступность':'Доступность'+(canAvailability()&&!slots.some(s=>Date.parse(s.end)>Date.now())?' · !':''),()=>{availabilityOpen=!availabilityOpen;availabilityMode=false;render()},availabilityOpen?'primary':'secondary'):null)
    if(canAvailability()&&!slots.some(s=>Date.parse(s.end)>Date.now())&&!availabilityOpen)controlsBar.append(el('span',{class:'availability-alert',role:'status'},'Нет будущих интервалов'))
    host.append(controlsBar);if(filtersOpen||view==='board')host.append(filters);else if(admin){const quick=select('quick_tutor',[['','Все репетиторы'],...tutorOptions()],selectedTutor);quick.setAttribute('aria-label','Репетитор');quick.addEventListener('change',()=>{selectedTutor=quick.value;render()});controlsBar.prepend(quick)}
    if(!shared&&(filtersOpen||view==='board'))host.append(el('div',{class:'calendar-legend'},...Object.keys(statuses).map(statusBadge),el('span',{class:'type-badge type-trial'},'Пробное'),el('span',{class:'payment-badge payment-paid'},'✓ Оплачено'),el('span',{class:'payment-badge payment-unpaid'},'○ Не оплачено')))
  }
  if(availabilityOpen&&['calendar','board'].includes(view)&&!embed&&!offline&&(account.role==='admin'||account.role==='tutor')){
    if(showAvailability())availabilityPanel(host)
    else host.append(el('p',{class:'availability-hint'},'Выберите репетитора, чтобы увидеть его свободное время.'))
  }
  main.append(host)
  root.append(el('div',{class:(embed||fullscreen||shared?'layout embedded':'layout')+(view==='calendar'?' calendar-layout':'')},(embed||fullscreen||shared)?null:sidebar,main))
  if(view==='users'&&!admin&&!canAvailability()){view='calendar';render();return}
  if(view==='users'){host.append(el('div',{class:'people'},users.map(u=>el('article',{},el('span',{class:'avatar'},u.name[0]),el('div',{},el('strong',{},u.name),el('small',{},u.guest?'Без аккаунта':u.username||roles[u.role])),el('span',{class:'pill'},roles[u.role]),admin&&u.role==='student'?button('Доступ',()=>accessDialog(u)):null))));return}
  if(view==='help'){helpPanel(host);return}
  if(view==='stats'){host.append(el('div',{class:'metrics'},...Object.entries(paymentStatuses).map(([key,label])=>el('article',{},el('span',{class:'muted'},label),el('strong',{},lessons.filter(l=>paymentOf(l)===key).length))),el('article',{},el('span',{class:'muted'},'Пробные'),el('strong',{},lessons.filter(l=>typeOf(l)==='trial').length))));return}
  if(view==='board'){board(host);return}
  const mount=el('div',{class:'calendar-host'});host.append(mount)
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'
  controls=createCalendarControlsPlugin()
  const calendars=Object.fromEntries(Object.entries(statusColors).map(([key,[main,container,onContainer]])=>[key,{colorName:key,lightColors:{main,container,onContainer},darkColors:{main,container:'#263142',onContainer:'#f0f3f8'}}]))
  calendar=createCalendar({locale:'ru-RU',timezone:zone,firstDayOfWeek:1,views:[createViewDay(),createViewWeek(),createViewMonthGrid(),createViewList()],defaultView:calendarView||(matchMedia('(max-width: 700px)').matches?'day':'week'),...(selectedDate?{selectedDate}:{}),plugins:[controls,createCurrentTimePlugin()],calendars,isDark:theme==='dark',weekOptions:{gridStep:30,gridHeight:1000},
    backgroundEvents:showAvailability()?freeSlots.filter(s=>account.role==='tutor'||s.tutor_id===selectedTutor).map(s=>({start:Temporal.Instant.from(s.start).toZonedDateTimeISO(zone),end:Temporal.Instant.from(s.end).toZonedDateTimeISO(zone),style:{backgroundColor:theme==='dark'?'#153b2a':'#dcfce7',border:'1px dashed '+(theme==='dark'?'#32794f':'#86efac'),pointerEvents:'none'},title:'Свободное время'})):[],
    events:visible().map(l=>({id:l.id,title:(shared?'':paymentOf(l)==='paid'?'✓ ':'○ ')+(typeOf(l)==='trial'?'Пробное · ':'')+l.title+' · '+(account.role==='student'?l.tutor_name:l.student_name),calendarId:statusOf(l),_options:{additionalClasses:['lesson-event','status-'+statusOf(l),'type-'+typeOf(l),'payment-'+paymentOf(l)]},start:Temporal.Instant.from(l.start).toZonedDateTimeISO(zone),end:Temporal.Instant.from(l.end).toZonedDateTimeISO(zone),description:[statuses[statusOf(l)],lessonTypes[typeOf(l)],shared?'':paymentStatuses[paymentOf(l)],l.tutor_name,l.student_name].filter(Boolean).join(' · ')})),
    callbacks:{onEventClick(event){if(Date.now()<suppressClickUntil)return;const lesson=lessons.find(l=>l.id===event.id);if(lesson)lessonDialog(lesson)},onClickDate(date){if(canEdit()){const at=Number(date.toPlainDateTime({hour:9}).toZonedDateTime(zone).epochMilliseconds);availabilityMode?slotDialog(null,at):lessonDialog(null,at)}},onClickDateTime(dateTime){if(Date.now()<suppressClickUntil)return;const at=Number(dateTime.epochMilliseconds);if(availabilityMode&&canAvailability())slotDialog(null,at);else if(canEdit()){const free=showAvailability()?freeSlots.find(s=>(account.role==='tutor'||s.tutor_id===selectedTutor)&&Date.parse(s.start)<=at&&Date.parse(s.end)>at):null;lessonDialog(null,at,free?.end)}}}})
  calendar.render(mount)
  installGridInteractions(mount,zone)
}
function installGridInteractions(mount,zone){
  let drag=null,preview=null
  const getTime=(day,y)=>{const r=day.getBoundingClientRect();const minutes=Math.max(0,Math.min(1410,Math.floor((y-r.top)/r.height*1440/30)*30));return Temporal.PlainDate.from(day.dataset.timeGridDate).toPlainDateTime({hour:Math.floor(minutes/60),minute:minutes%60}).toZonedDateTime(zone).epochMilliseconds}
  const create=(start,end)=>{if(availabilityMode&&canAvailability())slotDialog(null,start,end);else if(canEdit())lessonDialog(null,start,end?new Date(end).toISOString():undefined,!!end)}
  const cleanup=()=>{preview?.remove();preview=null;drag=null}
  mount.addEventListener('pointerdown',e=>{
    if(!canEdit()||e.button!==0||e.pointerType==='touch')return
    const day=e.target.closest('[data-time-grid-date]');if(!day)return
    const event=e.target.closest('.sx__event')
    if(event){const rect=event.getBoundingClientRect(),lesson=lessons.find(l=>l.id===event.dataset.eventId);if(!lesson||!event.classList.contains('sx__time-grid-event')||e.clientY<rect.bottom-8||rect.height<20)return;drag={day,start:Date.parse(lesson.start),y:e.clientY,resize:lesson};e.preventDefault()}
    else drag={day,start:getTime(day,e.clientY),y:e.clientY}
    try{day.setPointerCapture(e.pointerId)}catch{}
  })
  mount.addEventListener('pointermove',e=>{
    if(!drag||Math.abs(e.clientY-drag.y)<6&&!preview)return
    if(!preview){preview=el('div',{class:'range-preview'});drag.day.append(preview)}
    const end=getTime(drag.day,e.clientY),r=drag.day.getBoundingClientRect()
    const first=Math.max(0,Math.min(drag.y,e.clientY)-r.top),last=Math.min(r.height,Math.max(drag.y,e.clientY)-r.top)
    preview.style.top=first+'px';preview.style.height=Math.max(8,last-first)+'px'
    drag.end=end
  })
  mount.addEventListener('pointerup',e=>{
    if(!drag)return
    const d=drag,wasDrag=!!preview;cleanup()
    if(wasDrag){suppressClickUntil=Date.now()+400;const start=Math.min(d.start,d.end),end=Math.max(d.start,d.end)+1800000;if(d.resize){const newEnd=d.end+1800000;if(newEnd>d.start)api('lessons/'+d.resize.id,'PATCH',{end:new Date(newEnd).toISOString()}).then(refresh).catch(e=>notice(e.message));else notice('Окончание должно быть позже начала')}else create(start,end)}
    else if(d.day.hasPointerCapture(e.pointerId))d.day.releasePointerCapture(e.pointerId)
  })
  mount.addEventListener('pointercancel',cleanup)
  mount.addEventListener('lostpointercapture',cleanup)
  mount.addEventListener('contextmenu',e=>{if(!canEdit()||e.target.closest('.sx__event'))return;const day=e.target.closest('[data-time-grid-date]');if(day){e.preventDefault();create(getTime(day,e.clientY))}})
  mount.addEventListener('pointerover',e=>{const event=e.target.closest('[data-event-id]');if(!event)return;const l=lessons.find(x=>x.id===event.dataset.eventId);if(l)event.title=[l.title,l.student_name,l.tutor_name,statuses[statusOf(l)],shared?'':paymentStatuses[paymentOf(l)],timeFmt.format(new Date(l.start))+'–'+timeFmt.format(new Date(l.end))].filter(Boolean).join(' · ')})
}
async function refresh(){
  try{
    if(shared){const code=new URLSearchParams(location.hash.slice(1)).get('code')||'';const data=await api('shared-schedule','POST',{code});account={...data.student,role:'student'};lessons=data.lessons;users=[];render();return}
    const me=await api('me');if(account&&account.id!==me.user.id){dropCache();dispose();view='calendar';resetFilters()};account=me.user
    lessons=(await api('lessons')).lessons
    users=!embed?(account.role==='admin'?(await api('users')).users:account.role==='tutor'?(await api('students')).students:[]):[]
    const availability=!embed&&account.role!=='student'?await api('availability'):{slots:[],free:[]};slots=availability.slots;freeSlots=availability.free
    offline=false;snapshot();render()
  }catch(error){
    if(error.status===401){dropCache();account=null;lessons=[];users=[];slots=[];freeSlots=[];dispose();resetFilters();view='calendar';loginPage();return}
    if(!error.status&&!embed&&!shared){try{const saved=optedIn()&&JSON.parse(localStorage.getItem(CACHE));if(saved?.account){account=saved.account;lessons=saved.lessons;users=[];offline=true;view='board';render();notice('Офлайн-копия от '+fmt.format(new Date(saved.saved))+' · Только чтение');return}}catch{}}
    if(shared){root.replaceChildren(el('main',{class:'auth'},el('p',{role:'alert'},error.message)));return}
    loginPage();notice(error.message)
  }
}
window.addEventListener('online',()=>refresh())
window.addEventListener('offline',()=>{if(account&&!shared){offline=true;view='board';render()}})
if('serviceWorker'in navigator&&!embed&&!shared)navigator.serviceWorker.register('/sw.js').catch(()=>{})
window.addEventListener('keydown',e=>{if(!account||document.querySelector('dialog[open]')||e.ctrlKey||e.metaKey||e.altKey||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key.toLowerCase()==='n'&&canEdit()){e.preventDefault();lessonDialog()}if(e.key.toLowerCase()==='a'&&canAvailability()){e.preventDefault();availabilityOpen=!availabilityOpen;render()}})
if(new URLSearchParams(location.hash.slice(1)).has('invite'))authMode='register'
api('config').then(c=>{minPassword=c.minPassword}).catch(()=>{}).finally(refresh)
