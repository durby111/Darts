"""Actual Firestore emulator assertions with unsigned synthetic claims. No mocks/live calls."""
import base64,copy,hashlib,importlib.util,json,os,re,urllib.request,urllib.error
from pathlib import Path
from compose_rules import compose,ROOT
spec=importlib.util.spec_from_file_location('old_rules',ROOT/'dev/tests/isolated_rules_test.py');old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
KEY='blakeout-darts-dev:1:901185136996:web:89d4f413520e66ff773271'
def result(uid='alice',game='501'):
 return {'ownerId':uid,'participantIds':[uid],'perPlayer':json.dumps([{'playerId':uid,'gameType':game,'points':501 if game=='501' else 0,'darts':9,'marks':0 if game=='501' else 21}],separators=(',',':')),'gameType':game,'matchId':'synthetic','legScores':'[]','createdAt':1,'backendKey':KEY}
def cases():
 seed={'blakeoutDevProfiles/alice':{'name':'Alice'},'blakeoutDevProfiles/bob':{'name':'Bob'},'blakeoutDevCasualResults/saved':result(),'blakeoutDevCasualReceipts/saved$alice':{'ownerId':'alice','playerId':'alice','resultId':'saved','backendKey':KEY}}
 items=[]
 def add(name,auth,op,path,allow,data=None,**kw):items.append(dict(name=name,auth=auth,operation=op,path=path,allow=allow,data=data,**kw))
 for uid in ['alice','brandnew','google']:
  add('public verified own profile '+uid,uid,'write','blakeoutDevProfiles/'+uid,True,{'name':'Player'})
 for uid in [None,'anonymous','anonymous_verified','unverified','custom','apple']:
  add('deny private read '+str(uid),uid,'get','blakeoutDevCasualResults/saved',False)
  add('deny profile write '+str(uid),uid,'write','blakeoutDevProfiles/'+str(uid),False,{'name':'No'})
 add('cross-user profile update','bob','write','blakeoutDevProfiles/alice',False,{'name':'Forged'})
 add('profile private fields rejected','alice','write','blakeoutDevProfiles/alice',False,{'name':'Alice','email':'synthetic@example.test'})
 add('verified names get','brandnew','get','blakeoutDevProfiles/alice',True)
 add('unbounded directory denied','alice','list','blakeoutDevProfiles',False)
 add('bounded directory allowed','brandnew','query','blakeoutDevProfiles',True,limit=50)
 add('oversized directory denied','alice','query','blakeoutDevProfiles',False,limit=51)
 for game in ['501','cricket']:
  add('public own result '+game,'brandnew','write','blakeoutDevCasualResults/new',True,result('brandnew',game))
 add('unsupported 301 denied','alice','write','blakeoutDevCasualResults/new',False,result('alice','301'))
 foreign=result('alice');foreign['participantIds']=['bob'];foreign['perPlayer']=result('bob')['perPlayer']
 add('unsolicited other player history denied','alice','write','blakeoutDevCasualResults/new',False,foreign)
 add('owner spoof denied','bob','write','blakeoutDevCasualResults/new',False,result())
 wrong=result();wrong['backendKey']='other';add('wrong backend denied','alice','write','blakeoutDevCasualResults/new',False,wrong)
 wrong=result();wrong['perPlayer']=result('alice','cricket')['perPlayer'];add('counter game mismatch denied','alice','write','blakeoutDevCasualResults/new',False,wrong)
 add('own private result allowed','alice','get','blakeoutDevCasualResults/saved',True)
 add('other private result denied','bob','get','blakeoutDevCasualResults/saved',False)
 add('immutable update denied','alice','write','blakeoutDevCasualResults/saved',False,result())
 add('immutable delete denied','alice','delete','blakeoutDevCasualResults/saved',False)
 add('own history bounded query','alice','query','blakeoutDevCasualResults',True,limit=50,where=['ownerId','alice'])
 add('cross-user history bounded query denied','bob','query','blakeoutDevCasualResults',False,limit=50,where=['ownerId','alice'])
 add('unbounded own history denied','alice','query','blakeoutDevCasualResults',False,where=['ownerId','alice'])
 add('unfiltered result list denied','alice','list','blakeoutDevCasualResults',False)
 noReceipt=copy.deepcopy(seed);noReceipt.pop('blakeoutDevCasualReceipts/saved$alice')
 receipt={'ownerId':'alice','playerId':'alice','resultId':'saved','backendKey':KEY}
 add('own receipt creation','alice','write','blakeoutDevCasualReceipts/saved$alice',True,receipt,seed=noReceipt)
 add('foreign receipt creation denied','bob','write','blakeoutDevCasualReceipts/saved$alice',False,receipt,seed=noReceipt)
 add('own receipt bounded query','alice','query','blakeoutDevCasualReceipts',True,limit=50,where=['playerId','alice'])
 add('foreign receipt query denied','bob','query','blakeoutDevCasualReceipts',False,limit=50,where=['playerId','alice'])
 for collection in ['blakeoutDevTournaments','blakeoutDevRosterPrivate','blakeoutDevSignupState','blakeoutDevResults','tdEvents','qrGames']:
  add('public cannot acquire held capability '+collection,'brandnew','write',collection+'/new',False,{'ownerId':'brandnew'})
 add('public cannot create held resume','brandnew','write','blakeoutDevActiveGames/brandnew/games/new',False,{'ownerId':'brandnew'})
 add('client membership denied','brandnew','write','members/brandnew',False,{'role':'board'})
 return seed,items

def run():
 host=os.environ.get('FIRESTORE_EMULATOR_HOST','')
 if not re.fullmatch(r'127\.0\.0\.1:[0-9]{1,5}',host):raise SystemExit('BLOCKED: require explicit 127.0.0.1 Firestore emulator; no tests executed')
 project='demo-blakeout-public-policy';prefix=f'projects/{project}/databases/(default)/documents'
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 def request(method,path,data=None,uid=None,admin=False):
  headers={'Content-Type':'application/json'}
  if admin:headers['Authorization']='Bearer owner'
  elif uid:
   provider='anonymous' if uid.startswith('anonymous') else {'google':'google.com','custom':'custom','apple':'apple.com'}.get(uid,'password')
   claims={'sub':uid,'user_id':uid,'aud':project,'iss':'https://securetoken.google.com/'+project,'email_verified':uid not in ['unverified','anonymous'],'firebase':{'sign_in_provider':provider},'iat':0,'exp':4102444800}
   enc=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
   headers['Authorization']='Bearer '+enc({'alg':'none','typ':'JWT'})+'.'+enc(claims)+'.'
  req=urllib.request.Request('http://'+host+path,data=None if data is None else json.dumps(data).encode(),headers=headers,method=method)
  try:
   with opener.open(req,timeout=30) as response:return response.status,response.read().decode()
  except urllib.error.HTTPError as e:return e.code,e.read().decode()
 def writes(seed):return [{'update':{'name':prefix+'/'+p,'fields':{k:old.wire(v) for k,v in data.items()}}} for p,data in seed.items()]
 source=compose();seed,matrix=cases();assert source==(ROOT/'dev/public-pilot/firestore.public-proposed.rules').read_text()
 code,body=request('PUT',f'/emulator/v1/projects/{project}:securityRules',{'rules':{'files':[{'name':'public.rules','content':source}]}});assert code==200,(code,body)
 for c in matrix:
  assert request('DELETE',f'/emulator/v1/projects/{project}/databases/(default)/documents',admin=True)[0]==200
  assert request('POST','/v1/'+prefix+':commit',{'writes':writes(c.get('seed',seed))},admin=True)[0]==200
  op=c['operation'];path=c['path'];uid=c['auth']
  if op in ['get','list','delete']:code,body=request('DELETE' if op=='delete' else 'GET','/v1/'+prefix+'/'+path,uid=uid)
  elif op=='write':code,body=request('POST','/v1/'+prefix+':commit',{'writes':writes({path:c['data']})},uid=uid)
  else:
   q={'from':[{'collectionId':path}]}
   if 'limit' in c:q['limit']=c['limit']
   if 'where' in c:q['where']={'fieldFilter':{'field':{'fieldPath':c['where'][0]},'op':'EQUAL','value':old.wire(c['where'][1])}}
   code,body=request('POST','/v1/'+prefix+':runQuery',{'structuredQuery':q},uid=uid)
  assert (code==200 if c['allow'] else code==403),(c['name'],code,body)
  print('PASS',c['name'])
 # Overlapping synthetic device role must not become a public account principal.
 source=source.replace('function qrBoardUids() { return []; }','function qrBoardUids() { return ["board"]; }')
 assert request('PUT',f'/emulator/v1/projects/{project}:securityRules',{'rules':{'files':[{'name':'public-device-overlap.rules','content':source}]}})[0]==200
 for path,data in [('blakeoutDevProfiles/board',{'name':'Board'}),('blakeoutDevCasualResults/board',result('board'))]:
  code,body=request('POST','/v1/'+prefix+':commit',{'writes':writes({path:data})},uid='board');assert code==403,(code,body);print('PASS overlapping board denied',path)
 print(f'PASS {len(matrix)+2} public-policy actual emulator cases; source SHA256 '+hashlib.sha256(compose().encode()).hexdigest())
if __name__=='__main__':run()
