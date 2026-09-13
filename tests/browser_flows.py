"""Run with Python + Playwright and an installed Chrome. All API calls are mocked."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import threading, json, traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,*a): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    def page(path='index.html', setup='',width=390):
        context=browser.new_context(viewport={'width':width,'height':844},accept_downloads=True)
        p=context.new_page();p.errors=[];p.on('pageerror',lambda e:p.errors.append(str(e)))
        def route(r):
            url=r.request.url
            if 'supabase-js' in url: r.fulfill(content_type='application/javascript',body=(ROOT/'tests/mock-supabase.js').read_text()+setup)
            elif url.endswith('/config.js'):r.fulfill(content_type='application/javascript',body="window.UPXP_CONFIG={supabaseUrl:'https://mock.invalid',supabaseAnonKey:'test'};")
            elif url.startswith(origin):r.continue_()
            else:r.abort()
        p.route('**/*',route);p.goto(origin+'/'+path);p.wait_for_timeout(50);return p
    def run(name,fn):
        try:fn();results.append({'name':name,'passed':True});print('PASS',name,flush=True)
        except Exception as e:results.append({'name':name,'passed':False,'error':str(e)[:600]});print('FAIL',name,str(e)[:300],flush=True)
        finally:
            for c in browser.contexts:c.close()
    def check(ok,msg='assertion failed'):
        if not ok:raise AssertionError(msg)
    def game(setup=''):
        return page(setup="mock.player.score=900;"+setup)
    def prime(p):
        p.evaluate("state.player={...mock.player};state.challenge={...mock.challenge};renderChallenge();showScreen('challengeScreen');selectAnswer(0)")
    run('welcome boot, no JavaScript errors',lambda:check(not page().errors))
    def registration():
        p=page();p.locator('[data-action=start]').first.click();p.fill('#playerName','Ana Teste');p.fill('#playerPhone','44999999999');p.check('#privacyConsent');p.locator('#registerForm button').click();p.wait_for_timeout(50)
        check(p.locator('#instructionsScreen').is_visible());check(p.evaluate('state.player.name')=='Ana Teste');check(p.evaluate("!!localStorage.getItem('upxp_player')"));check(not p.errors)
    run('registration persists participant and opens instructions',registration)
    for mode in ['throw','P0001']:
        def reg_error(mode=mode):
            p=page(setup=f"mock.failures['rpc:register_player']='{mode}';");p.evaluate("document.getElementById('playerName').value='Ana';document.getElementById('playerPhone').value='44999999999'");p.evaluate("registerPlayer({preventDefault(){},submitter:document.querySelector('#registerForm button')})");check(not p.locator('#registerForm button').is_disabled());check(p.evaluate('state.player') is None)
        run('registration error '+mode,reg_error)
    for stored in ['{bad','true','{}','{"id":"bad","name":"Ana"}','null']:
        def invalid(stored=stored):
            p=page(setup='localStorage.setItem("upxp_player",'+json.dumps(stored)+');');check(p.evaluate('state.player') is None);check(not p.errors,str(p.errors))
        run('invalid saved participant '+stored,invalid)
    def storage_denied():
        p=page(setup="Object.defineProperty(Storage.prototype,'getItem',{value(){throw Error('denied')}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw Error('denied')}});")
        p.evaluate("state.player={...mock.player};updatePlayer();document.querySelector('[data-action=enter-game]').click()");check(p.locator('#gameScreen').is_visible());check(not p.errors,str(p.errors))
    run('storage denied still permits playing',storage_denied)
    for mode in ['throw','error','empty','answered','valid']:
        def code(mode=mode):
            p=game();p.evaluate('state.player={...mock.player}')
            if mode in ['throw','error']:p.evaluate("m=>mock.failures['rpc:get_challenge_by_code']=m",mode)
            if mode=='empty':p.evaluate("mock.responses['rpc:get_challenge_by_code']=[]")
            if mode=='answered':p.evaluate('mock.challenge.already_answered=true')
            p.evaluate("validateCode({preventDefault(){},submitter:document.querySelector('#codeForm button')})")
            check(not p.locator('#codeForm button').is_disabled());check(not p.errors,str(p.errors))
            if mode=='valid':check(p.locator('#challengeScreen').is_visible())
        run('code lookup '+mode,code)
    for mode in ['throw','error','empty','correct','wrong']:
        def answer(mode=mode):
            p=game();prime(p)
            if mode in ['throw','error']:p.evaluate("m=>mock.failures['rpc:submit_answer']=m",mode)
            if mode=='empty':p.evaluate("mock.responses['rpc:submit_answer']=[]")
            if mode=='wrong':p.evaluate("mock.responses['rpc:submit_answer']=[{is_correct:false,points_earned:0}]")
            p.evaluate('submitAnswer(0)')
            if mode in ['throw','error','empty']:check(not p.locator('#confirmAnswer').is_disabled())
            else:check(p.locator('#answerFeedback').is_visible())
            check(not p.errors,str(p.errors))
        run('normal answer '+mode,answer)
    def duplicate():
        p=game();prime(p);p.evaluate("mock.delay['rpc:submit_answer']=50");p.evaluate('Promise.all([submitAnswer(0),submitAnswer(0)])');check(p.evaluate("mock.calls.filter(c=>c.key==='rpc:submit_answer').length")==1)
    run('double submit normal question sends once',duplicate)
    def completed():
        p=game();prime(p);p.evaluate('submitAnswer(0)');p.evaluate('selectAnswer(1)');check(p.locator('#confirmAnswer').is_disabled())
    run('completed normal question cannot be reopened by answer selection',completed)
    for mode in ['throw','error','empty','valid']:
        def ranking(mode=mode):
            p=game();p.evaluate('state.player={...mock.player};showScreen("gameScreen")')
            if mode in ['throw','error']:p.evaluate("m=>mock.failures['from:leaderboard']=m",mode)
            if mode=='empty':p.evaluate("mock.responses['from:leaderboard']=[]")
            p.evaluate('loadRanking()');p.evaluate('loadRanking()');check(p.evaluate('state.previous')=='gameScreen');check(p.evaluate('state.player.id') is not None);check(not p.errors,str(p.errors))
        run('ranking '+mode+' and return navigation',ranking)
    def feed_fail():
        p=game();p.evaluate("mock.failures['from:leaderboard']='throw'");p.evaluate('updateActivityFeed()');check(not p.errors)
    run('background feed tolerates network failure',feed_fail)
    for score in [999,1000,1500]:
        def unlock(score=score):
            p=page();p.evaluate('(score)=>{state.player={...mock.player,score};updatePlayer()}',score);check(p.locator('#bonusHub').is_visible()==False if score<1000 else p.evaluate("!document.getElementById('bonusHub').classList.contains('hidden')"));check(p.locator('#bonusModal').is_visible()==(score>=1000));check(p.evaluate("document.getElementById('codePanel').classList.contains('hidden')")==(score>=1000))
        run('bonus threshold '+str(score),unlock)
    def bonus_setup(p):p.evaluate('mock.player.score=1000;state.player={...mock.player};state.bonusCelebrated.add(state.player.id)')
    for mode in ['correct','timeout','throw','empty','double']:
        def bonus(mode=mode):
            p=page();bonus_setup(p)
            if mode=='empty':p.evaluate("mock.responses['rpc:start_bonus_round']=null")
            p.evaluate('startBonusRound()')
            if mode=='empty':check(not p.locator('#bonusContinue').is_disabled());return
            if mode=='timeout':p.evaluate('state.bonus.deadline=performance.now()-1')
            if mode=='throw':p.evaluate("mock.failures['rpc:submit_bonus_answer']='throw'")
            if mode=='double':p.evaluate("mock.delay['rpc:submit_bonus_answer']=50;Promise.all([submitBonusAnswer(0),submitBonusAnswer(0)])")
            else:p.evaluate('submitBonusAnswer(0)')
            check(not p.evaluate('state.bonusBusy'))
            if mode=='throw':check(not p.locator('#confirmAnswer').is_disabled())
            else:check(p.evaluate('state.bonus.finished'))
            if mode=='double':check(p.evaluate("mock.calls.filter(c=>c.key==='rpc:submit_bonus_answer').length")==1)
            if mode=='timeout':check(p.evaluate("mock.calls.find(c=>c.key==='rpc:submit_bonus_answer').payload.selected_index") is None)
        run('bonus '+mode,bonus)
    for fmt in ['post','story','certificate']:
        def sharing(fmt=fmt):
            p=page();p.evaluate("state.player={...mock.player,score:1200,name:'Nome muito longo de participante para conferir o limite da arte'};document.querySelector('[data-action=share-achievement]').click()")
            p.locator(f'[data-share-format={fmt}]').click();p.wait_for_function("document.getElementById('sharePreview').naturalWidth>0 && !document.getElementById('shareDownload').disabled")
            dims=p.locator('#sharePreview').evaluate('(i)=>[i.naturalWidth,i.naturalHeight]');check(dims=={'post':[1080,1080],'story':[1080,1920],'certificate':[1600,1132]}[fmt]);
            with p.expect_download() as download:p.locator('#shareDownload').click()
            check(download.value.suggested_filename.endswith('.png'));check(not p.errors,str(p.errors))
        run('share '+fmt+' render and PNG download',sharing)
    def admin(setup='',path='admin.html'):return page(path,setup="mock.user={user:{id:'admin'}};"+setup)
    for path in ['admin.html','funil.html']:
        def boot(path=path):
            p=admin(path=path);p.wait_for_timeout(100);check(p.locator('#dashboardView').is_visible());check(p.locator('#leadsBody tr').count()==1);check(not p.errors,str(p.errors))
        run('CRM boot '+path,boot)
    def login_failure():
        p=page('admin.html',setup="mock.failures.login='throw';");p.fill('#adminEmail','test@example.com');p.fill('#adminPassword','invalid');p.locator('#loginForm button').click();p.wait_for_timeout(50);check(not p.errors,str(p.errors));check(p.locator('#loginMessage').inner_text()!='Entrando...')
    run('CRM login network failure handled',login_failure)
    def denied():
        p=admin("mock.responses['rpc:is_campaign_admin']=false;");check(p.locator('#loginView').is_visible());check(p.evaluate('allLeads.length')==0)
    run('CRM non-admin access denied',denied)
    def logout():
        p=admin();p.wait_for_timeout(100);p.evaluate("openContact('lead-1')");p.locator('#closeContact').click();p.locator('#logoutButton').click();p.wait_for_timeout(50);check(p.evaluate('allLeads.length')==0);check(p.locator('#leadsBody').inner_text()=='')
    run('CRM logout clears private data',logout)
    for mode in ['success','error','throw']:
        def move(mode=mode):
            p=admin();p.wait_for_timeout(100)
            if mode!='success':p.evaluate("m=>mock.failures['update:campaign_leads']=m",mode)
            p.evaluate("moveLead('lead-1','contatado')");check(p.evaluate('allLeads[0].status')==('contatado' if mode=='success' else 'novo'));check(p.evaluate('savingLeads.size')==0)
        run('CRM move '+mode,move)
    for mode in ['success','error']:
        def contact(mode=mode):
            p=admin();p.wait_for_timeout(100)
            if mode=='error':p.evaluate("mock.failures['from:campaign_leads']='error'")
            p.evaluate("openContact('lead-1')");check(p.locator('#contactDialog').is_visible());check(p.locator('#saveContact').is_disabled()==(mode=='error'));check(not p.errors,str(p.errors))
        run('CRM open contact '+mode,contact)
    def filters():
        p=admin();p.wait_for_timeout(100);p.fill('#searchInput','no match');check(p.locator('#leadsBody tr').count()==0);p.fill('#searchInput','44999');check(p.locator('#leadsBody tr').count()==1);p.select_option('#consentFilter','no');check(p.locator('#leadsBody tr').count()==0)
    run('CRM search and consent filters',filters)
    def temperature():
        p=admin();p.wait_for_timeout(100);check(p.evaluate("leadTemperature({tags:['Interesse','INTERESSE'],player:{completed_count:1}}).fill")==42);check(p.evaluate("leadTemperature({tags:['Interesse'],player:{completed_count:10}}).fill")==100)
    run('CRM temperature deduplication and cap',temperature)
    for width in [320,390,768,1440]:
        def layout(width=width):
            p=page(width=width);p.evaluate('state.player={...mock.player,score:1200};state.bonusCelebrated.add(state.player.id);updatePlayer();showScreen("gameScreen")');check(p.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'horizontal overflow');check(p.locator('#bonusHub').bounding_box()['y']>p.locator('.game-header').bounding_box()['y']+p.locator('.game-header').bounding_box()['height'])
        run('game responsive '+str(width),layout)
    browser.close()
server.shutdown()
Path('/tmp/upxp-browser-results.json').write_text(json.dumps(results,indent=2,ensure_ascii=False))
print(f"{sum(r['passed'] for r in results)}/{len(results)} passed")
raise SystemExit(any(not r['passed'] for r in results))
