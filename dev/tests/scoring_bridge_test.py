#!/usr/bin/env python3
"""Real DEV scorer/engine/platform integration; only Firebase SDK and return-page boundaries mocked."""
import asyncio
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import sys
import threading

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / ".sb"
sys.dont_write_bytecode = True
PRODUCTION_SNAPSHOT = '{\n  "type": "501", "players": [{"name":"Production","score":267}], "tournament": null\n}'

STORE = """
export const getFirestore=()=>({});
const read=()=>JSON.parse(localStorage.__documents || '{}');
const snapshot=ref=>({id:ref.id,exists:()=>ref.path in read(),data:()=>read()[ref.path]});
const online=()=>{if(localStorage.__offline==='1')throw Error('Offline');};
export const collection=(db,path)=>({path});
export const doc=(db,name,id)=>({path:name+'/'+id,id});
export const getDocFromServer=async ref=>{online();return snapshot(ref);};
export const query=(collection,filter)=>({...collection,filter});
export const where=(field,op,value)=>({field,op,value});
export const getDocsFromServer=async ref=>{
  online();
  if(localStorage.__slowProfiles==='1' && ref.path==='blakeoutDevProfiles')
    await new Promise(resolve=>{globalThis.releaseProfiles=resolve;});
  return {docs:Object.entries(read())
    .filter(([path,value])=>path.startsWith(ref.path+'/') &&
      (!ref.filter || (ref.filter.op==='==' ? value[ref.filter.field]===ref.filter.value :
        value[ref.filter.field].includes(ref.filter.value))))
    .map(([path])=>snapshot({path,id:path.split('/').at(-1)}))};
};
export const runTransaction=async(db,callback)=>{
  online();
  const writes=[];
  const result=await callback({
    get:async ref=>{if(writes.length)throw Error('Read after write');return snapshot(ref);},
    set:(ref,value)=>writes.push([ref.path,structuredClone(value)])
  });
  const docs=read();
  writes.forEach(([path,value])=>{docs[path]=value;});
  localStorage.__documents=JSON.stringify(docs);
  const results=Object.fromEntries(Object.entries(docs)
    .filter(([path])=>path.startsWith('blakeoutDevResults/'))
    .map(([path,value])=>[path.split('/')[1],value]));
  if(Object.keys(results).length)localStorage.__results=JSON.stringify(results);
  if(localStorage.__lostReply==='1' && writes.some(([path])=>path.startsWith('blakeoutDevResults/') || path.startsWith('blakeoutDevCasualResults/')))
    throw Error('Connection lost after commit');
  return result;
};
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


async def fixture(page, base, game_type="301", best_of=3, account="owner", stale=False, ordinary=False):
    await page.goto(base + "/dev/")
    await page.evaluate("""async ({gameType,bestOf,account,stale,ordinary,production}) => {
      localStorage.clear();
      localStorage.blakeout_active_game=production;
      localStorage.__productionBaseline=production;
      localStorage.blakeout_dev_active_game_imported='1';
      const e = await import('./js/brackets/engine.js');
      const p = await import('./js/platform.js');
      await p.initPlatform();
      for(const uid of ['u1','u2','u4','owner']) {
        changeTestUser({uid,emailVerified:true,isAnonymous:false});
        await p.saveProfile('Same');
      }
      let t = await p.createTournamentDocument(e.createTournament({id:'test',ownerId:'owner',title:'Test',date:'2026-09-07',gameType,bestOf}));
      t = await p.updateTournament(t.id,t.revision,current=>e.saveRoster(current, [
        {id:'r1',playerId:'u1',name:'Same',tag:'A',paid:true,checkedIn:true,standby:false},
        {id:'r2',playerId:'u2',name:'Same',tag:'A',paid:true,checkedIn:true,standby:false},
        {id:'r3',playerId:null,name:'Guest',tag:'B',paid:true,checkedIn:true,standby:false},
        {id:'r4',playerId:'u4',name:'Human',tag:'B',paid:true,checkedIn:true,standby:false}
      ]));
      const random = Math.random;
      Math.random = () => 0.99;
      let started;
      try { started = e.startTournament(t); } finally { Math.random = random; }
      t = await p.updateTournament(t.id,t.revision,()=>started);
      changeTestUser({uid:account,emailVerified:true,isAnonymous:false});
      const match = t.matches.find(m => m.status === 'ready');
      localStorage.blakeout_dev_match_launch = JSON.stringify({
        tournamentId:t.id,matchId:match.id,revision:t.revision + (stale ? 1 : 0),
        gameType:'tampered', bestOf:999, teams:[{name:'Imposter'}]
      });
      if(ordinary) localStorage.blakeout_dev_active_game=JSON.stringify({
        type:'501',players:[{name:'Ordinary',score:321},{name:'Other',score:456}],
        currentPlayer:0,pendingDarts:[],tournament:null
      });
    }""", {"gameType": game_type, "bestOf": best_of, "account": account, "stale": stale, "ordinary": ordinary, "production": PRODUCTION_SNAPSHOT})
    await page.goto(base + "/dev/?tournamentMatch=1")
    await page.wait_for_function("""() => {
      const n=document.getElementById('tournamentBridgeNotice');
      return n && !n.textContent.includes('Verifying');
    }""")


async def state(page, expression):
    return await page.evaluate(f"""async () => {{
      const {{game}} = await import('./js/state.js');
      if(localStorage.__productionBaseline && localStorage.blakeout_active_game !== localStorage.__productionBaseline)
        throw Error('DEV changed the production snapshot');
      return {expression};
    }}""")


async def storage_migration(page, base):
    await page.goto(base + "/dev/")
    await page.evaluate("""async raw=>{
      const s=await import('./js/state.js');
      localStorage.clear();
      localStorage.blakeout_active_game=raw;
      const legacy=s.loadActiveGame();
      if(legacy.players[0].score!==267 || localStorage.blakeout_dev_active_game!==raw)
        throw Error('Ordinary legacy snapshot was not copied exactly');
      legacy.players[0].score=123;
      s.restoreActiveGame(legacy);
      s.saveActiveGame();
      if(localStorage.blakeout_active_game!==raw)throw Error('DEV save mutated production');
      s.clearActiveGame();
      if(s.loadActiveGame()!==null || localStorage.blakeout_active_game!==raw)
        throw Error('Clear resurrected legacy data or changed production');
      s.game.players=[];
    }""", PRODUCTION_SNAPSHOT)
    await page.reload()
    assert await page.evaluate("(async()=>(await import('./js/state.js')).loadActiveGame())()") is None
    assert await page.evaluate("localStorage.blakeout_active_game") == PRODUCTION_SNAPSHOT
    await page.evaluate("""async raw=>{
      const s=await import('./js/state.js');
      localStorage.clear();
      if(s.loadActiveGame()!==null)throw Error('Unexpected empty migration');
      localStorage.blakeout_active_game=raw;
      if(s.loadActiveGame()!==null)throw Error('Imported a later production game after migration');
      localStorage.clear();
      localStorage.blakeout_active_game='not JSON';
      if(s.loadActiveGame()!==null || localStorage.blakeout_active_game!=='not JSON')
        throw Error('Malformed legacy snapshot was changed');
    }""", PRODUCTION_SNAPSHOT)
    await fixture(page, base)
    await page.evaluate("""async()=>{
      const s=await import('./js/state.js');
      const raw=localStorage.blakeout_dev_active_game;
      localStorage.removeItem('__productionBaseline');
      localStorage.blakeout_active_game=raw;
      localStorage.removeItem('blakeout_dev_active_game');
      localStorage.removeItem('blakeout_dev_active_game_imported');
      const copied=s.loadActiveGame();
      if(copied.tournament.resultId!==s.game.tournament.resultId ||
         JSON.stringify(copied.scoringRecords)!==JSON.stringify(s.game.scoringRecords) ||
         localStorage.blakeout_dev_active_game!==raw || localStorage.blakeout_active_game!==raw)
        throw Error('Legacy DEV tournament context/ledger was lost during migration');
      s.clearActiveGame();
      if(s.loadActiveGame()!==null || localStorage.blakeout_active_game!==raw)
        throw Error('Legacy DEV tournament was resurrected or production changed');
      s.game.players=[];
    }""")
    print("PASS DEV storage isolation and one-time ordinary/tournament migration")


async def storage_budget(page, base):
    for kind, casual in [("501", False), ("cricket", False), ("501", True), ("cricket", True)]:
        if casual:
            await casual_fixture(page, base, kind, teams=[2, 3], links=["u1", "u2", "u3", "u4", "u5"])
        else:
            await fixture(page, base, kind)
        measured = await page.evaluate("""async kind=>{
          const s=await import('./js/state.js'), r=await import('./js/scoring-records.js');
          const teams=await import('./js/teams.js');
          s.recordingSession().bestOf=3;
          let peak=0;
          const bytes=()=>2*localStorage.blakeout_dev_active_game.length;
          const same=(a,b)=>JSON.stringify(a,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))) : value)
            ===JSON.stringify(b,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))) : value);
          for(let leg=0;leg<3;leg++){
            if(leg)r.beginScoringLeg(kind);
            s.game.undoHistory=[];s.game.redoHistory=[];
            s.game.currentPlayer=leg===1?1:0;
            s.game.players.forEach(p=>{p.score=kind==='501'?501:0;p.history=[];});
            for(let visit=0;visit<99;visit++){
              s.saveGameState();
              const player=s.game.players[s.game.currentPlayer];
              const points=kind==='501'?(visit===98?60:9):0;
              r.recordTurn({points,darts:3,marks:kind==='cricket'&&visit>=85?3:0});
              player.history.push({score:points,thrower:teams.currentThrower(s.game.currentPlayer).name});
              if(kind==='501')player.score-=points;
              if(visit<98){
                teams.advanceRotation(s.game.currentPlayer);
                s.game.currentPlayer=1-s.game.currentPlayer;
              }
              if(!s.saveActiveGame())throw Error('Representative long match exceeded quota');
              peak=Math.max(peak,bytes());
            }
            r.finishScoringLeg(s.game.currentPlayer);
            s.saveActiveGame();
          }
          const expectedUndo=structuredClone(s.game.undoHistory);
          s.restoreActiveGame(s.loadActiveGame());
          if(s.game.undoHistory.length!==99 || !same(s.game.undoHistory,expectedUndo))
            throw Error('Compact persistence altered undo history');
          s.undoLastAction();
          const expectedRedo=structuredClone(s.game.redoHistory);
          s.restoreActiveGame(s.loadActiveGame());
          if(!same(s.game.redoHistory,expectedRedo))throw Error('Compact persistence altered redo history');
          s.redoLastAction();
          globalThis.budgetTemplate=structuredClone(s.loadActiveGame());
          return {peakBytes:peak,uncompressedUndoBytes:JSON.stringify(expectedUndo).length*2,
            visits:s.game.scoringRecords.legs.reduce((n,l)=>n+l.turns.length,0)};
        }""", kind)
        await page.evaluate("localStorage.__offline='1'")
        await page.evaluate("""async casual=>{
          if(casual)await (await import('./js/casual-recording.js')).saveCasualResult();
          else await (await import('./js/tournament-bridge.js')).saveTournamentResult();
        }""", casual)
        pending_id = await state(page, "(game.recording||game.tournament).resultId")
        prefix = "blakeout_dev_casual_" if casual else "blakeout_dev_match_"
        pending_key = prefix + pending_id
        pending_bytes = await page.evaluate("key=>localStorage.getItem(key)", pending_key)
        await page.evaluate("localStorage.__offline='0'")
        completed = await page.evaluate("""async ({kind,casual,prefix})=>{
          const s=await import('./js/state.js'), p=await import('./js/platform.js');
          const e=await import('./js/brackets/engine.js'), b=await import('./js/tournament-bridge.js');
          const c=await import('./js/casual-recording.js');
          const original=casual?null:await p.getTournament('test');
          const field=casual?'recording':'tournament';
          localStorage.setItem(prefix+'old-confirmed',JSON.stringify({
            ...globalThis.budgetTemplate,undoHistory:[],redoHistory:[],
            [field]:{...globalThis.budgetTemplate[field],status:'saved'}
          }));
          for(let i=0;i<12;i++){
            let t;
            if(!casual){
              t=await p.createTournamentDocument(e.createTournament({
                id:'budget_'+kind+'_'+i,ownerId:'owner',title:'Budget',date:'2026-09-07',gameType:kind,bestOf:3
              }));
              t=await p.updateTournament(t.id,t.revision,x=>e.saveRoster(x,original.registrations));
              const random=Math.random;Math.random=()=>0.99;
              let started;try{started=e.startTournament(t);}finally{Math.random=random;}
              t=await p.updateTournament(t.id,t.revision,()=>started);
            }
            s.restoreActiveGame(structuredClone(globalThis.budgetTemplate));
            const session=s.recordingSession();
            if(t){session.tournamentId=t.id;session.revision=t.revision;}
            session.resultId=crypto.randomUUID();
            s.game.scoringRecords.id=session.resultId;
            s.game.scoringRecords.legs.forEach(leg=>{
              leg.id=crypto.randomUUID();leg.turns.forEach(turn=>{turn.id=crypto.randomUUID();});
            });
            s.game.undoHistory=[];s.game.redoHistory=[];
            s.saveActiveGame();
            if(casual)await c.saveCasualResult();else await b.saveTournamentResult();
            if(session.status!=='saved')throw Error('Budget match failed to save');
            const saved=JSON.parse(localStorage.blakeout_dev_active_game);
            if(saved.undoHistory.length || saved.redoHistory.length || s.recordingSession(saved).pendingResult ||
                saved.scoringRecords.legs.some(l=>l.turns.length))
              throw Error('Confirmed saved state retained redundant raw history');
            if(localStorage.getItem(prefix+session.resultId))
              throw Error('Confirmed recovery copy was not pruned');
          }
          const keys=Object.keys(localStorage).filter(key=>key==='blakeout_dev_active_game' ||
            (key.startsWith(prefix)&&key!=='blakeout_dev_match_launch'&&key!=='blakeout_dev_casual_history'));
          return {completed:12,retainedKeys:keys,savedSummaryBytes:2*localStorage.blakeout_dev_active_game.length,
            retainedBytes:keys.reduce((n,k)=>n+2*(k.length+localStorage[k].length),0)};
        }""", {"kind": kind, "casual": casual, "prefix": prefix})
        assert await page.evaluate("key=>localStorage.getItem(key)", pending_key) == pending_bytes
        assert measured["visits"] == 297
        assert measured["peakBytes"] < 500_000, measured
        assert len(completed["retainedKeys"]) == 2, completed
        assert completed["retainedBytes"] < 500_000, completed
        print(f"PASS storage budget {'casual' if casual else 'tournament'} {kind}: {json.dumps({**measured, **completed})}")


async def score(page, points, darts=None):
    if darts is not None:
        await page.select_option("#tournamentActualDarts", str(darts))
    await page.evaluate("""async points => {
      const {game} = await import('./js/state.js');
      game.currentInput = String(points);
      (await import('./js/x01.js')).submitScore();
    }""", points)
    await page.wait_for_timeout(720)


async def checkout(page, player=0):
    await page.evaluate("""async player => {
      const {game} = await import('./js/state.js');
      game.currentPlayer = player; game.players[player].score = 40;
    }""", player)
    await score(page, 40, 1)


async def casual_fixture(page, base, kind="301", players=2, teams=None, links=None, start=True):
    await page.goto(base + "/dev/")
    await page.evaluate("""async production=>{
      localStorage.clear();
      localStorage.blakeout_active_game=production;
      localStorage.__productionBaseline=production;
      localStorage.blakeout_dev_active_game_imported='1';
      const p=await import('./js/platform.js');await p.initPlatform();
      for(const uid of ['u1','u2','u3','u4','u5','owner']){
        changeTestUser({uid,emailVerified:true,isAnonymous:false});await p.saveProfile('Same');
      }
    }""", PRODUCTION_SNAPSHOT)
    await page.select_option("#gameType", kind)
    await page.select_option("#numPlayers", str(players))
    await page.check("#recordCasualStats")
    if teams:
        await page.evaluate("""sizes=>{
          localStorage.blakeout_last_team_setup=JSON.stringify({
            teams:sizes.map((n,team)=>Array.from({length:n},(_,i)=>({name:'Same '+team+'-'+i}))),firstTeam:0
          });
        }""", teams)
        await page.check("#teamMode")
    else:
        await page.uncheck("#teamMode")
        for i in range(players):
            await page.fill(f"#player{i+1}", "Same")
    await page.click("#startGameBtn")
    if teams:
        await page.click("#teamStartMatchBtn")
    await page.wait_for_selector("#casualLink0")
    await page.wait_for_function("document.getElementById('casualLinkStatus').textContent.includes('Verified scorekeeper ID')")
    assert await page.locator("#casualLink0").input_value() == ""
    links = links if links is not None else ["u1"] + [""] * ((sum(teams) if teams else players) - 1)
    for i, uid in enumerate(links):
        await page.select_option(f"#casualLink{i}", uid)
    if not start:
        return
    await page.click("#casualLinkStart")
    await page.wait_for_function("document.getElementById('casualLinkModal').style.display==='none'")
    assert await state(page, "game.tournament") is None
    assert await state(page, "game.recording.source") == "casual"


async def close_cricket_leg(page, winner=0):
    await page.evaluate("""async winner=>{
      const {game}=await import('./js/state.js');
      game.currentPlayer=winner;
      game.cricketTargets.forEach(t=>{
        game.players[winner].cricketData[t].marks=3;game.players[winner].cricketData[t].closed=true;
      });
      game.players[winner].cricketData['20'].marks=2;game.players[winner].cricketData['20'].closed=false;
      const c=await import('./js/cricket.js');c.hitTarget('20',1);c.cricketConfirm();
    }""", winner)


async def personal_results(page, uid="u1"):
    return await page.evaluate("""async uid=>{
      const p=await import('./js/platform.js');
      changeTestUser({uid,emailVerified:true,isAnonymous:false});
      try{return await p.listMyResults();}
      finally{changeTestUser({uid:'owner',emailVerified:true,isAnonymous:false});}
    }""", uid)


async def casual_cases(page, base):
    for kind in ["301", "501", "cricket", "spanish", "minnesota", "chicago"]:
        await casual_fixture(page, base, kind)
        if kind == "chicago":
            await page.click("#chicago301Btn")
            await checkout(page)
            await page.click("#chicagoContinueBtn")
            await page.click("#chicagoCricketBtn")
            await close_cricket_leg(page)
        elif kind in ["301", "501"]:
            await checkout(page)
        else:
            await close_cricket_leg(page)
        assert await state(page, "game.recording.legComplete")
        await page.click("#casualSaveResult")
        await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Casual result saved')")
        results = await personal_results(page)
        assert len(results) == 1 and results[0]["source"] == "casual"
        assert results[0]["participantIds"] == ["u1"]
        assert sum(s["darts"] for s in results[0]["perPlayer"]) == (2 if kind == "chicago" else 1)
    print("PASS six casual games through real platform, single-slot UID selection, guest exclusion")

    await casual_fixture(page, base, teams=[2, 3], links=["u1", "u2", "u3", "u4", "u5"])
    assert await state(page, "game.teams.map(t=>t.members.length)") == [2, 3]
    for _ in range(6):
        await score(page, 9, 3)
    assert await state(page, "game.scoringRecords.legs[0].turns.map(t=>t.playerId)") == ["u1", "u3", "u2", "u4", "u1", "u5"]
    await page.evaluate("(async()=>{const s=await import('./js/state.js');s.undoLastAction();s.redoLastAction();})()")
    await page.reload()
    await page.click("#resumeGameBtn")
    assert await state(page, "game.scoringRecords.legs[0].turns.at(-1).playerId") == "u5"
    await checkout(page)
    await page.evaluate("changeTestUser({uid:'u4',emailVerified:true,isAnonymous:false})")
    await page.click("#casualSaveResult")
    await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('original verified scorekeeper')")
    pending_id = await state(page, "game.recording.resultId")
    await page.evaluate("changeTestUser({uid:'owner',emailVerified:true,isAnonymous:false});localStorage.__offline='1'")
    await page.click("#casualSaveResult")
    await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Not saved')")
    await page.click("#newGameBtn")
    await page.uncheck("#recordCasualStats")
    await page.uncheck("#teamMode")
    await page.click("#startGameBtn")
    assert await state(page, "game.recording") is None
    await page.reload()
    await page.click("#casualLocalHistory summary")
    await page.click(f"#casualResume-{pending_id}")
    assert await state(page, "game.recording.resultId") == pending_id
    await page.evaluate("localStorage.__offline='0';localStorage.__lostReply='1'")
    await page.click("#casualSaveResult")
    await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Not saved')")
    await page.evaluate("localStorage.__lostReply='0'")
    await page.click("#casualSaveResult")
    await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Casual result saved')")
    for uid in ["u1", "u2", "u3", "u4", "u5"]:
        results = await personal_results(page, uid)
        assert len(results) == 1 and len(results[0]["participantIds"]) == 5
    assert await page.evaluate("Object.keys(JSON.parse(localStorage.__documents)).filter(k=>k.startsWith('blakeoutDevCasualResults/')).length") == 1
    print("PASS five-human team rotation, identity undo/reload, wrong account, offline recovery and duplicate save")

    await casual_fixture(page, base, "301", players=4, links=["owner", "u2", "", "u4"])
    for _ in range(4):
        await score(page, 9, 3)
    assert await state(page, "game.scoringRecords.legs[0].turns.map(t=>t.playerId)") == ["owner", "u2", None, "u4"]
    await checkout(page, 1)
    second_side = await state(page, "game.recording.teams[1].id")
    assert await state(page, "game.recording.winnerIndex") == 1
    assert await state(page, "game.scoringRecords.legs[0].winnerId") == second_side
    await page.evaluate("localStorage.__slowProfiles='1'")
    await page.click("#casualSaveResult")
    await page.wait_for_function("typeof globalThis.releaseProfiles==='function'")
    assert await page.locator("#playAgainBtn").is_disabled()
    assert await page.locator("#newGameBtn").is_disabled()
    saving_id = await state(page, "game.recording.resultId")
    await page.evaluate("(async()=>(await import('./js/setup.js')).playAgain())()")
    assert await state(page, "game.recording.resultId") == saving_id
    await page.evaluate("localStorage.__slowProfiles='0';globalThis.releaseProfiles()")
    await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Casual result saved')")
    second_winner_result = (await personal_results(page, "owner"))[0]
    assert second_winner_result["participantIds"] == ["owner", "u2", "u4"]
    assert second_winner_result["winnerId"] == second_side
    assert second_winner_result["records"]["winnerIds"] == [second_side]
    assert second_winner_result["legScores"][0]["winnerId"] == second_side
    print("PASS four singles, scorekeeper also playing and in-flight save protects the current game")

    await casual_fixture(page, base, "301", players=1)
    await checkout(page)
    await page.click("#casualSaveResult")
    await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Casual result saved')")
    assert len((await personal_results(page))[0]["records"]["winnerIds"]) == 1

    await casual_fixture(page, base, "chicago", players=3, links=["u1", "u2", "u3"])
    await page.click("#chicago301Btn")
    await checkout(page, 0)
    await page.click("#chicagoContinueBtn")
    await page.click("#chicago501Btn")
    await checkout(page, 1)
    await page.reload()
    await page.click("#resumeGameBtn")
    await page.click("#chicagoContinueBtn")
    await page.click("#chicagoCricketBtn")
    await close_cricket_leg(page, 2)
    assert await state(page, "game.recording.legWins") == [1, 1, 1]
    tied_sides = await state(page, "game.recording.teams.map(t=>t.id)")
    await page.click("#casualSaveResult")
    await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Casual result saved')")
    result = (await personal_results(page))[0]
    assert result["winnerId"] is None and result["records"]["winnerIds"] == tied_sides
    assert [leg["winnerId"] for leg in result["legScores"]] == tied_sides
    assert [leg["gameType"] for leg in result["legScores"]] == ["301", "501", "cricket"]
    print("PASS solo recording and three-player Chicago tied series with inter-leg resume")

    await casual_fixture(page, base, links=["u1", "u1"], start=False)
    await page.click("#casualLinkStart")
    await page.wait_for_function("document.getElementById('casualLinkStatus').textContent.includes('only one human slot')")
    assert await state(page, "game.recording") is None
    await page.select_option("#casualLink1", "u2")
    await page.evaluate("changeTestUser({uid:'u4',emailVerified:true,isAnonymous:false})")
    await page.click("#casualLinkStart")
    await page.wait_for_function("document.getElementById('casualLinkStatus').textContent.includes('current verified scorekeeper')")
    await page.evaluate("""()=>{
      changeTestUser({uid:'owner',emailVerified:true,isAnonymous:false});
      const docs=JSON.parse(localStorage.__documents);delete docs['blakeoutDevProfiles/u2'];localStorage.__documents=JSON.stringify(docs);
    }""")
    await page.click("#casualLinkStart")
    await page.wait_for_function("document.getElementById('casualLinkStatus').textContent.includes('no longer available')")
    await page.evaluate("localStorage.__slowProfiles='1'")
    await page.click("#casualLinkReload")
    await page.click("#casualLinkSkip")
    assert await state(page, "game.recording") is None
    assert await state(page, "game.players.length") == 2
    await page.evaluate("localStorage.__slowProfiles='0';globalThis.releaseProfiles?.()")
    print("PASS duplicate UID, changed scorekeeper, authoritative missing profile and nonblocking ordinary play")

    await page.goto(base + "/dev/")
    await page.evaluate("localStorage.clear();localStorage.__offline='1'")
    await page.reload()
    await page.select_option("#gameType", "901")
    await page.check("#recordCasualStats")
    assert "not recorded" in await page.locator("#casualRecordingHint").inner_text()
    await page.click("#startGameBtn")
    assert await state(page, "game.recording") is None
    assert await state(page, "game.players[0].score") == 901
    print("PASS unsupported games remain playable unrecorded offline")
    await page.evaluate("(async()=>(await import('./js/setup.js')).showSetup())()")
    await page.select_option("#gameType", "301")
    await page.uncheck("#recordCasualStats")
    await page.click("#startGameBtn")
    await score(page, 9)
    assert await state(page, "game.players[0].score") == 292
    assert await state(page, "game.recording") is None
    print("PASS supported ordinary game stays offline without darts/identity requirements")


async def minnesota_cases(page, base):
    for casual in [False, True]:
        if casual:
            await casual_fixture(page, base, "minnesota")
        else:
            await fixture(page, base, "minnesota", 3)
        await page.evaluate("""async()=>{
          const c=await import('./js/cricket.js');c.hitTarget('Bed',1);c.cricketConfirm();
        }""")
        first = await state(page, "game.scoringRecords.legs[0].turns[0]")
        assert first["darts"] == 3 and first["marks"] == 1
        await page.evaluate("""async()=>{
          const s=await import('./js/state.js');s.undoLastAction();
          if(s.game.scoringRecords.legs[0].turns.length)throw Error('Bed undo retained statistics');
          s.redoLastAction();
        }""")
        await page.evaluate("""async()=>{
          const {game}=await import('./js/state.js');game.currentPlayer=0;
          game.players[0].cricketData.Triples.marks=3;game.players[0].cricketData.Triples.closed=true;
          (await import('./js/cricket.js')).hitTarget('Triples',1);
        }""")
        await page.click("[data-keypad='6']")
        await page.click("[data-keypad='0']")
        await page.reload()
        if casual:
            await page.click("#resumeGameBtn")
        await page.wait_for_selector("#scoreKeypadModal", state="visible")
        assert await page.locator("#keypadDisplay").inner_text() == "60"
        await page.click("[data-keypad='OK']")
        await page.click("#tournamentMissDart")
        await page.click("#tournamentMissDart")
        await page.click("#enterBtn")
        turn = await state(page, "game.scoringRecords.legs[0].turns.at(-1)")
        assert (turn["points"], turn["darts"], turn["marks"]) == (60, 3, 1)
        await page.evaluate("""async()=>{
          const {game}=await import('./js/state.js');game.currentPlayer=0;
          game.players[0].cricketData.Bed.marks=3;game.players[0].cricketData.Bed.closed=true;
          (await import('./js/cricket.js')).hitTarget('Bed',1);
        }""")
        await page.click("[data-keypad='8']")
        await page.click("[data-keypad='0']")
        await page.click("[data-keypad='OK']")
        await page.click("#enterBtn")
        turn = await state(page, "game.scoringRecords.legs[0].turns.at(-1)")
        assert (turn["points"], turn["darts"], turn["marks"]) == (80, 3, 1)
        await close_cricket_leg(page)
        if not casual:
            await page.click("#tournamentNextLeg")
            await close_cricket_leg(page)
        await page.click("#casualSaveResult" if casual else "#tournamentSaveResult")
        await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.toLowerCase().includes('result saved')")
        result = (await personal_results(page))[0]
        assert result["perPlayer"][0]["gameType"] == "minnesota"
    print("PASS Minnesota tournament/casual Bed darts, special scoring marks, keypad persistence and result save")


async def tablet_layouts(page, base):
    shots = ROOT / "Screenshots/tournament-tablets"
    if os.environ.get("SCORING_SCREENSHOTS"):
        shots.mkdir(parents=True, exist_ok=True)
    for width, height in [(800, 600), (600, 800)]:
        await page.set_viewport_size({"width": width, "height": height})
        for kind, leg_type in [("301", None), ("cricket", None), ("minnesota", None), ("chicago", "301"), ("chicago", "cricket")]:
            await fixture(page, base, kind)
            skin = os.environ.get("SCORING_TABLET_SKIN", "modern")
            await page.evaluate("async skin=>(await import('./js/settings.js')).applyScoreSkin(skin)", skin)
            if leg_type:
                await page.click("#chicago301Btn" if leg_type == "301" else "#chicagoCricketBtn")
            cricket = (leg_type or kind) in ["cricket", "minnesota"]
            assert await page.locator("#tournamentActualDarts").is_visible() == (not cricket)
            assert await page.locator("#tournamentMissDart").is_visible() == cricket
            await page.click("#tournamentHelp")
            assert await page.locator("#tournamentHelpModal").is_visible()
            await page.click("#tournamentHelpClose")
            if cricket:
                await page.locator(".cricket-dt-btn[data-target='20'][data-multiplier='3']").click()
                await page.click("#tournamentMissDart")
                await page.click("#tournamentMissDart")
            else:
                await page.select_option("#tournamentActualDarts", "3")
                await page.evaluate("""async()=> {
                  const {game}=await import('./js/state.js'); game.players[0].score=160;
                  (await import('./js/x01.js')).updateX01Display();
                }""")
                await page.locator(".x01-num-btn[data-digit='6']").click()
                await page.locator(".x01-num-btn[data-digit='0']").click()
            if os.environ.get("SCORING_SCREENSHOTS"):
                await page.screenshot(path=str(shots / f"{kind}-{leg_type or kind}-{width}x{height}-{skin}.png"))
            metrics = await page.evaluate("""({cricket,minnesota})=>{
              const screen=document.getElementById('gameScreen');
              const selectors=cricket
                ? '#scoreHeader,#menuBtn,#tournamentHelp,#tournamentScoringControls,#cricketControls,#enterBtn,#tournamentMissDart'+
                  (minnesota?'':',.cricket-num-btn,.cricket-dt-btn:not(.fake-spacer)')
                : '#scoreHeader,#menuBtn,#tournamentHelp,#tournamentScoringControls,#x01Controls,#inputDisplay,#tournamentActualDarts,#x01EnterBtn,.x01-num-btn,.x01-quick-btn';
              return {overflow:screen.scrollHeight-screen.clientHeight,
                elements:[...document.querySelectorAll(selectors)].filter(el=>el.getClientRects().length)
                  .map(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                    return {id:el.id||el.className,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
                      interactive:el.matches('button,select'),hit:hit===el||el.contains(hit)};})};
            }""", {"cricket": cricket, "minnesota": kind == "minnesota"})
            assert metrics["overflow"] <= 1, (width, height, kind, metrics)
            for item in metrics["elements"]:
                assert item["top"] >= 0 and item["bottom"] <= height + 1, (width, height, kind, item)
                if item["interactive"]:
                    assert item["width"] >= 44 and item["height"] >= 44 and item["hit"], (width, height, kind, item)
            if kind == "minnesota":
                for target in ["Triples", "Doubles", "Bed"]:
                    control = page.locator(f".cricket-num-btn[data-target='{target}']")
                    await control.scroll_into_view_if_needed()
                    assert await control.evaluate("""el=>{
                      const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                      return r.width>=44&&r.height>=44&&(hit===el||el.contains(hit));
                    }""")
            await page.click("#enterBtn" if cricket else "#x01EnterBtn")
            assert await state(page, "game.scoringRecords.legs[0].turns.length") == 1
            print(f"PASS tablet {kind}/{leg_type or kind} {width}x{height}")
        for kind in ["301", "cricket", "minnesota"]:
            await casual_fixture(page, base, kind, players=4 if kind != "minnesota" else 2,
                                 teams=[2, 3] if kind == "minnesota" else None,
                                 start=False)
            assert await page.locator("#casualLinkStart").evaluate("""el=>{
              const r=el.getBoundingClientRect();
              return r.top>=0&&r.bottom<=innerHeight&&r.height>=44;
            }""")
            if os.environ.get("SCORING_SCREENSHOTS"):
                await page.screenshot(path=str(shots / f"casual-link-{kind}-{width}x{height}.png"))
            await page.click("#casualLinkStart")
            await page.wait_for_function("document.getElementById('casualLinkModal').style.display==='none'")
            skin = os.environ.get("SCORING_TABLET_SKIN", "modern")
            await page.evaluate("async skin=>(await import('./js/settings.js')).applyScoreSkin(skin)", skin)
            assert await page.evaluate("""cricket=>{
              const screen=document.getElementById('gameScreen');
              const selectors='#scoreHeader,#menuBtn,#tournamentScoringControls,'+
                (cricket?'#cricketControls,#enterBtn':'#x01Controls,#x01EnterBtn,#inputDisplay,.x01-num-btn,.x01-quick-btn');
              return screen.scrollHeight<=screen.clientHeight+1 &&
                [...document.querySelectorAll(selectors)].every(el=>{
                  if(!el.getClientRects().length)return true;
                  const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                  return r.top>=0&&r.bottom<=innerHeight+1&&(!el.matches('button')||
                    (r.width>=44&&r.height>=44&&(hit===el||el.contains(hit))));
                });
            }""", kind != "301")
            if os.environ.get("SCORING_SCREENSHOTS"):
                await page.screenshot(path=str(shots / f"casual-{kind}-{width}x{height}-{skin}.png"))
            if kind == "301":
                await checkout(page)
                await page.locator("#casualSaveResult").scroll_into_view_if_needed()
                assert await page.locator("#playAgainBtn").is_visible()
                assert await page.locator("#newGameBtn").is_visible()
                if os.environ.get("SCORING_SCREENSHOTS"):
                    await page.screenshot(path=str(shots / f"casual-winner-{width}x{height}-{skin}.png"))
            print(f"PASS casual tablet {kind} and linking/result UI {width}x{height}")
    await page.set_viewport_size({"width": 1000, "height": 1400})


async def run():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    os.environ["TMPDIR"] = str(RUNTIME)
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    from playwright.async_api import async_playwright
    from platform_test import APP, AUTH
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                executable_path="/usr/bin/google-chrome", headless=True,
                args=["--no-sandbox"], env={**os.environ, "TMPDIR": str(RUNTIME)})
            context = await browser.new_context(service_workers="block", viewport={"width": 1000, "height": 1400})

            async def boundary(route):
                sdk = {
                    "firebase-app.js": APP,
                    "firebase-auth.js": AUTH.replace("verified_owner", "owner"),
                    "firebase-firestore.js": STORE,
                }
                if route.request.url.startswith("https://www.gstatic.com/firebasejs/10.13.2/"):
                    body = sdk.get(route.request.url.rsplit("/", 1)[-1])
                    if body is None:
                        await route.abort()
                    else:
                        await route.fulfill(status=200, content_type="text/javascript", body=body)
                elif route.request.url.startswith(base):
                    await route.continue_()
                else:
                    await route.abort()

            await context.route("**/*", boundary)
            page = await context.new_page()
            page.set_default_timeout(6000)
            errors = []
            page.on("pageerror", lambda e: (errors.append(str(e)), print("BROWSER ERROR:", e)))
            cancel_ordinary = False
            page.on("dialog", lambda dialog: dialog.dismiss() if cancel_ordinary and "ordinary game" in dialog.message else dialog.accept())
            if os.environ.get("SCORING_CASUAL_ONLY"):
                await casual_cases(page, base)
                await minnesota_cases(page, base)
                assert not errors, errors
                await browser.close()
                return
            if os.environ.get("SCORING_TABLETS_ONLY"):
                await tablet_layouts(page, base)
                assert not errors, errors
                await browser.close()
                return
            await storage_migration(page, base)
            if os.environ.get("SCORING_STORAGE_ONLY"):
                assert not errors, errors
                await browser.close()
                return
            await storage_budget(page, base)
            if os.environ.get("SCORING_BUDGET_ONLY"):
                assert not errors, errors
                await browser.close()
                return
            await tablet_layouts(page, base)
            await casual_cases(page, base)
            await minnesota_cases(page, base)

            await fixture(page, base, account="intruder")
            assert "Only the tournament owner" in await page.locator("#tournamentBridgeNotice").inner_text()
            assert not await state(page, "game.tournament")
            await fixture(page, base, stale=True)
            assert "bracket changed" in await page.locator("#tournamentBridgeNotice").inner_text()
            print("PASS authoritative ownership and stale launch")
            cancel_ordinary = True
            await fixture(page, base, ordinary=True)
            assert "cancelled" in await page.locator("#tournamentBridgeNotice").inner_text()
            assert await page.evaluate("JSON.parse(localStorage.blakeout_dev_active_game).players[0].score") == 321
            assert not await state(page, "game.tournament")
            cancel_ordinary = False
            print("PASS cancelled launch preserves saved ordinary game")

            await fixture(page, base)
            assert await state(page, "game.type") == "301"
            assert await page.evaluate("typeof JSON.parse(localStorage.__documents)['blakeoutDevTournaments/test'].matches") == "string"
            assert await state(page, "game.teams[0].members.map(m=>m.playerId)") == ["u1", "u2"]
            await score(page, 60)
            assert await state(page, "game.scoringRecords.legs[0].turns.length") == 0
            await score(page, 60, 2)
            await score(page, 0, 3)
            await score(page, 60, 3)
            turns = await state(page, "game.scoringRecords.legs[0].turns")
            assert [(t["playerId"], t["darts"]) for t in turns] == [("u1", 2), (None, 3), ("u2", 3)]
            ids = [t["id"] for t in turns]
            await page.evaluate("""async () => {
              const s=await import('./js/state.js'); s.undoLastAction(); s.redoLastAction();
            }""")
            assert await state(page, "game.scoringRecords.legs[0].turns.map(t=>t.id)") == ids
            await page.reload()
            await page.wait_for_selector("#tournamentActualDarts")
            assert await state(page, "game.scoringRecords.legs[0].turns.map(t=>t.id)") == ids
            await page.evaluate("""async () => {
              const {game}=await import('./js/state.js'); game.currentPlayer=0; game.players[0].score=20;
            }""")
            await score(page, 60, 1)
            bust = await state(page, "game.scoringRecords.legs[0].turns.at(-1)")
            assert bust["bust"] and bust["points"] == 0 and bust["darts"] == 1
            await checkout(page)
            assert await state(page, "game.tournament.legWins") == [1, 0]
            await page.evaluate("""async () => {
              const s=await import('./js/state.js'); s.undoLastAction();
            }""")
            assert await state(page, "game.tournament.legWins") == [0, 0]
            await page.evaluate("(async()=>{(await import('./js/state.js')).redoLastAction()})()")
            assert await state(page, "game.tournament.legWins") == [1, 0]
            await page.click("#tournamentNextLeg")
            await checkout(page)
            assert await state(page, "game.scoringRecords.legs.length") == 2
            await page.evaluate("localStorage.__offline='1'")
            await page.click("#tournamentSaveResult")
            await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Not saved')")
            result_id = await state(page, "game.tournament.resultId")
            assert await state(page, "game.tournament.status") == "pending"
            assert await page.evaluate("localStorage.__results || null") is None
            await page.reload()
            await page.wait_for_function("document.getElementById('tournamentBridgeNotice').textContent.includes('not launched')")
            await page.click("#resumeGameBtn")
            assert await state(page, "game.tournament.resultId") == result_id
            await page.evaluate("localStorage.__offline='0'; localStorage.__lostReply='1'")
            await page.click("#tournamentSaveResult")
            await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Not saved')")
            await page.evaluate("localStorage.__lostReply='0'")
            await page.click("#tournamentSaveResult")
            await page.wait_for_function("document.getElementById('tournamentResultPanel').textContent.includes('Result saved')")
            results = await page.evaluate("""async()=>{
              const p=await import('./js/platform.js');
              changeTestUser({uid:'u1',emailVerified:true,isAnonymous:false});
              try { return Object.fromEntries((await p.listMyResults()).map(r=>[r.id,r])); }
              finally { changeTestUser({uid:'owner',emailVerified:true,isAnonymous:false}); }
            }""")
            assert len(results) == 1 and result_id in results
            assert results[result_id]["ownerId"] == "owner" and results[result_id]["tournamentId"] == "test"
            assert all(s["playerId"] for s in results[result_id]["perPlayer"])
            assert all(s["gameType"] == "301" for s in results[result_id]["perPlayer"])
            assert results[result_id]["participantIds"] == ["u1", "u2", "u4"]
            assert {(s["playerId"], s["points"], s["darts"]) for s in results[result_id]["perPlayer"]} == {
                ("u1", 100, 4), ("u2", 100, 4)
            }
            await page.evaluate("""async()=>{
              const s=await import('./js/state.js');s.clearActiveGame();
              if(s.loadActiveGame()!==null || localStorage.blakeout_active_game!==localStorage.__productionBaseline)
                throw Error('Tournament clear changed or reimported production');
            }""")
            print("PASS identity rotation, actual darts, bust, undo/redo, reload, series, offline retry, idempotency")

            for kind in ["cricket", "spanish"]:
                await fixture(page, base, kind, 1)
                await page.evaluate("""async () => {
                  const c=await import('./js/cricket.js');
                  c.hitTarget('20',3); c.cricketConfirm();
                }""")
                assert await state(page, "game.scoringRecords.legs[0].turns.length") == 0
                await page.click("#tournamentMissDart")
                await page.click("#tournamentMissDart")
                await page.evaluate("(async()=>{(await import('./js/cricket.js')).cricketConfirm()})()")
                turn = await state(page, "game.scoringRecords.legs[0].turns[0]")
                assert turn["darts"] == 3 and turn["marks"] == 3
                await page.evaluate("""async () => {
                  const {game}=await import('./js/state.js');
                  game.currentPlayer=0;
                  game.cricketTargets.forEach(t => {
                    game.players[0].cricketData[t].marks=3;
                    game.players[0].cricketData[t].closed=true;
                  });
                  const target=game.cricketTargets.at(-1);
                  game.players[0].cricketData[target].marks=2;
                  game.players[0].cricketData[target].closed=false;
                  const c=await import('./js/cricket.js');
                  c.hitTarget(target,1); c.hitTarget('20',3); c.cricketConfirm();
                }""")
                turn = await state(page, "game.scoringRecords.legs[0].turns.at(-1)")
                assert turn["darts"] == 1 and turn["marks"] == 1
                assert await state(page, "game.tournament.legWins") == [1, 0]
            print("PASS Cricket/Spanish scoring marks, explicit misses, early winning dart")

            await fixture(page, base, "501", 1)
            await checkout(page)
            assert await state(page, "game.scoringRecords.legs[0].gameType") == "501"
            await fixture(page, base, "chicago", 3)
            await page.click("#chicago301Btn")
            await checkout(page)
            await page.click("#chicagoContinueBtn")
            await page.click("#chicagoCricketBtn")
            await page.evaluate("""async () => {
              const {game}=await import('./js/state.js');
              game.currentPlayer=1;
              game.cricketTargets.forEach(t => {
                game.players[1].cricketData[t].marks=3;
                game.players[1].cricketData[t].closed=true;
              });
              game.players[1].cricketData.Bull.marks=2;
              game.players[1].cricketData.Bull.closed=false;
              const c=await import('./js/cricket.js'); c.hitTarget('Bull',1); c.cricketConfirm();
            }""")
            await page.click("#chicagoContinueBtn")
            await page.click("#chicago501Btn")
            await checkout(page)
            assert await state(page, "game.tournament.legWins") == [2, 1]
            assert await state(page, "game.chicago.legWins") == [2, 1]
            assert await state(page, "game.scoringRecords.legs.map(l=>l.gameType)") == ["301", "cricket", "501"]
            print("PASS 501 and Chicago leg retention without double counting")
            await page.route(base + "/dev/brackets/**", lambda route: route.fulfill(
                status=200, content_type="text/html", body="<title>Bracket return boundary</title>"))
            await page.click("#tournamentResultReturn")
            await page.wait_for_url(base + "/dev/brackets/?id=test")
            assert await page.evaluate("JSON.parse(localStorage.blakeout_dev_active_game).scoringRecords.legs.length") == 3
            print("PASS canonical bracket return preserves unsent ledger")

            # Exercise existing regressions directly: no legacy /tmp report runner.
            import dev_test
            await page.set_viewport_size({"width": 900, "height": 1600})
            for name in [
                "core_cricket", "core_x01", "team_throw_order", "resume_target_game",
                "x01_remaining_entry", "x01_live_preview", "x01_miss_bust_symbols",
                "x01_no_stale_score_game2", "cricket_pending_mark_count", "chicago_match_flow",
                "long_x01_starts", "count_up", "gotcha", "shark_tank", "tic_tac_toe",
                "robin_hood", "double_down_cricket", "team_cricket_400", "cricket_quickie",
                "dc_scoreboard_family", "dedicated_engine_resume", "all_games_boot",
                "multiplayer_score_visibility", "multiplayer_cricket_grid_fit",
                "multiplayer_cricket_marks_visible", "round_badge_all_engines"
            ]:
                await page.goto(base + "/dev/")
                await page.evaluate("localStorage.clear()")
                await page.reload()
                await getattr(dev_test, f"test_{name}")(page)
                print(f"PASS existing {name}")
            assert not errors, errors
            await browser.close()
    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(RUNTIME, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(run())
