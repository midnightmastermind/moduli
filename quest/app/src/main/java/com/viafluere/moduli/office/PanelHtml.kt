package com.viafluere.moduli.office

import org.json.JSONArray
import org.json.JSONObject

/**
 * The pages the shelf and screen panels show. They are plain HTML built here (no Moduli app loads in them), so a
 * room full of shelves costs one copy of the app — the control panel — not one per shelf. Taps go back through the
 * same `ModuliNative.postMessage` bridge the control panel uses.
 */
object PanelHtml {
  private fun esc(s: String): String =
      s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")

  private fun js(s: String): String = JSONObject.quote(s)

  /** A JS string inside a double-quoted HTML attribute (onclick="…"): js()'s own quotes would end the attribute,
   *  so they are written as &quot; (the browser turns them back before running the code). */
  private fun ja(s: String): String = esc(js(s))

  /** Panel height above the shelf itself, for the title and buttons. */
  const val HEADER_M = 0.14f

  private val SPINE_COLORS = listOf("#7a2e2e", "#2e4a7a", "#3f6b34", "#7a5a2e", "#4a2e7a", "#2e6b6b", "#8a6a3a", "#5a3a2a")

  private const val BRIDGE = """
    function send(o){ try { ModuliNative.postMessage(JSON.stringify(o)); } catch(e) {} }
  """

  /**
   * A shelf: its items' spines (cover + title) at the slots ShelfLayout gives, paged. The app lays a grabbable 3D book
   * over each slot (OfficeActivity), so the spines here are what you SEE and the books what you HOLD: `hold(id, on)`
   * hides the spine of a book in your hand, and a page change is reported (`shelfPage`) so the books follow it.
   */
  fun shelf(shelf: JSONObject, slots: List<ShelfLayout.Slot>, shelfHeightM: Float, page: Int, moving: Int = 0): String {
    val id = shelf.optString("id")
    val asset = shelf.optString("asset", "book")
    val title = shelf.optString("title", "Shelf")
    val items: JSONArray = shelf.optJSONArray("items") ?: JSONArray()
    val headerPct = HEADER_M / (shelfHeightM + HEADER_M) * 100f
    // A folder shelf is a tree: where it stands (Documents › Notes) and a way back up.
    val pathArr = shelf.optJSONArray("path") ?: JSONArray()
    val path = (0 until pathArr.length()).joinToString(" › ") { pathArr.optString(it) }
    val canUp = shelf.optBoolean("canUp")
    val data = JSONArray()
    for (i in 0 until items.length()) {
      val it = items.getJSONObject(i)
      data.put(JSONObject().put("id", it.optString("id")).put("t", it.optString("title")).put("c", it.optString("cover", ""))
          .put("r", it.optString("rowId", "").ifEmpty { it.optString("id") }).put("f", it.optBoolean("folder")).put("n", it.optInt("count")).put("m", it.optBoolean("mini")))
    }
    val rects = JSONArray()
    for (sl in slots) rects.put(JSONArray().put(sl.leftPct.toDouble()).put(sl.bottomPct.toDouble()).put(sl.wPct.toDouble()).put(sl.hPct.toDouble()))
    return """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;background:transparent;font-family:Georgia,serif;color:#f4e9d8;overflow:hidden}
  #head{height:${headerPct}vh;display:flex;align-items:center;gap:2vw;padding:0 2vw;box-sizing:border-box;background:rgba(40,26,16,.82);border-radius:1.5vh}
  /* The name over its count and page, stacked, and small: in one row beside the buttons a Bookmarks shelf read
     "B…" (user, 2026-10-25). */
  #info{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;line-height:1.15}
  #head b{font-size:1.9vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #pg{font-size:1.4vh;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  button{font-size:2.6vh;padding:.3vh 1.4vw;border-radius:.8vh;border:1px solid #a88;background:#3a2616;color:#f4e9d8}
  #rows{position:relative;height:${100f - headerPct}vh}
  .it{position:absolute;border-radius:.6vh;box-shadow:0 0 .6vh rgba(0,0,0,.6);background-size:cover;background-position:center;
      display:flex;align-items:flex-end;justify-content:center;overflow:hidden;cursor:pointer}
  /* Small titles (user: "way smaller"), allowed most of the spine so long titles show more words. */
  .it span{font-size:.75vh;line-height:1.15;padding:.3vh;background:rgba(0,0,0,.55);width:100%;text-align:center;
      max-height:85%;overflow:hidden;word-break:break-word}
  /* The spot of a book in your hand: an empty, glowing outline, so you can see where it goes back. */
  .it.held{background:none!important;box-shadow:0 0 2vh #ffd27a;outline:.5vh dashed #ffd27a;outline-offset:-.5vh}
  .it.held span{visibility:hidden}
  /* The book a controller points at: the one a grab will take. */
  .it.hover{outline:.5vh solid #fff;outline-offset:-.5vh;box-shadow:0 0 2.5vh #fff;transform:translateY(-1vh)}
  /* Where a carried book will be dropped (a folder book, or the ⬆): lit while the controller aims at it. */
  .it.drop{outline:.7vh solid #6cf!important;outline-offset:-.7vh;box-shadow:0 0 3vh #6cf!important;transform:translateY(-1vh)}
  #upb.drop{background:#1f5f99;border-color:#6cf;box-shadow:0 0 2.5vh #6cf}
  #empty{padding:4vh 4vw;font-size:4.5vh;background:rgba(0,0,0,.5);margin:3vh;border-radius:1vh}
  /* A folder is a book you open: a darker spine with a folder mark and how much is inside. */
  /* A song opened out of its album: a smaller record, centred in its slot (its handle-able proxy shrinks the same). */
  .it.mini{transform:scale(.62);transform-origin:50% 50%}
  /* Its title, big enough to read at that size (a song's name was too small to see). */
  .it.mini span{font-size:1.5vh;max-height:100%;background:rgba(0,0,0,.7)}
  .it.fold{border:.4vh solid #c9a46a;box-sizing:border-box}
  ${if (asset == "record") RECORD_LABELS else ""}
  /* A folder with no picture is a plain leather spine; one with a picture (an artist on the record crate) shows it. */
  .it.fold:not(.pic){background:linear-gradient(#5a4632,#3b2c1d)!important}
  .it.fold span:before{content:'📁 ';}
  .it.fold i{position:absolute;top:2.6vh;left:0;right:0;text-align:center;font-style:normal;font-size:.9vh;color:#f4e9d8}
  /* What marks a folder at a glance (user, 2026-10-27: "we need something on the book that shows if its a folder"):
     a gold FOLDER band across the top, in plain text, and a thicker gold edge. */
  .it.fold{border-width:.7vh}
  .it.fold:after{content:'FOLDER';position:absolute;top:0;left:0;right:0;padding:.35vh 0;background:#d9b06a;color:#2a1a0c;
      font:700 1vh/1 Arial,sans-serif;letter-spacing:.15vh;text-align:center}
  /* Select mode: tap books to pick them, then Delete. */
  .it.sel{outline:.6vh solid #ff6b6b!important;outline-offset:-.6vh;box-shadow:0 0 2vh #ff6b6b!important}
  #path{font-size:1.3vh;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  button.on{background:#7a2e2e}
  #nf{font-size:2.2vh;width:14vw;padding:.3vh .8vw;border-radius:.8vh;border:1px solid #a88;background:#1e140c;color:#f4e9d8}
  #q{font-size:2.2vh;width:16vw;min-width:0;padding:.3vh .8vw;border-radius:.8vh;border:1px solid #a88;background:#1e140c;color:#f4e9d8}
  button.danger{background:#8a2020;border-color:#f99}
</style></head><body>
<div id="head">${if (canUp) """<button id="upb" onclick="send({type:'shelfUp',key:key})">⬆</button>""" else ""}<div id="info"><b>${esc(title)}</b>
  ${if (path.isNotEmpty() && canUp) """<span id="path">${esc(path)}</span>""" else ""}<span id="pg"></span></div>
  <input id="q" placeholder="🔍 Search" oninput="search()">
  <button onclick="go(-1)">◀</button><button onclick="go(1)">▶</button>
  ${if (shelf.optBoolean("folderable")) """<button onclick="send({type:'newNote',key:key})">＋📝</button><button id="nfb" onclick="newFolder()">＋📁</button><span id="nfbox" style="display:none"><input id="nf" placeholder="Folder name" onkeydown="if(event.key==='Enter')addFolder()"><button onclick="addFolder()">Add</button></span>""" else ""}
  ${if (moving > 0) """<button class="on" onclick="send({type:'moveHere',key:key})">Move $moving here</button><button onclick="send({type:'moveCancel',key:key})">✕</button>""" else ""}
  <button id="selb" onclick="toggleSel()">Select</button><button id="movb" style="display:none" onclick="mv()"></button><button id="openb" style="display:none" onclick="opn()"></button><button id="delb" class="danger" style="display:none" onclick="del()"></button>
  <button onclick="send({type:'piece',key:${ja("shelf:$id")}})">⚙</button></div>
<div id="rows"></div>
<script>$BRIDGE
  var items=$data, rects=$rects, asset=${js(asset)}, key=${js("shelf:$id")}, FOLDERABLE=${shelf.optBoolean("folderable")}, CANUP=$canUp;
  // A new folder where the shelf stands: a name box (no prompt — a web prompt never shows inside a headset panel).
  function newFolder(){ var b=document.getElementById('nfbox'); b.style.display=b.style.display==='none'?'inline':'none'; if(b.style.display!=='none') document.getElementById('nf').focus(); }
  function addFolder(){ var i=document.getElementById('nf'); var n=(i.value||'').trim(); if(!n) return; send({type:'newFolder',key:key,name:n}); i.value=''; document.getElementById('nfbox').style.display='none'; }
  var colors=${JSONArray(SPINE_COLORS)};
  function hash(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h);}
  // `all` is everything on the shelf; `items` what shows (the search's matches). The app lays its books over `items`.
  var all=items, q='', per=rects.length, pages=Math.max(1,Math.ceil(items.length/per)), page=Math.min($page,pages-1), held={}, hoverId=null, dropId=null;
  function go(d){page=(page+d+pages)%pages;draw();send({type:'shelfPage',key:key,page:page});}
  var searchT=null;
  function search(){clearTimeout(searchT);searchT=setTimeout(function(){
    var v=document.getElementById('q').value.trim().toLowerCase(); if(v===q)return; q=v;
    items=v?all.filter(function(it){return String(it.t||'').toLowerCase().indexOf(v)>=0;}):all;
    pages=Math.max(1,Math.ceil(items.length/per)); page=0; draw();
    send({type:'shelfFilter',key:key,page:0,ids:v?items.map(function(it){return it.id;}):null});
  },300);}
  // Pointing and holding change ONE spine's look, never the page: draw() rebuilds every spine and reloads every
  // cover, which made pointing along a shelf lag (it ran on each move from one book to the next).
  var nodes={};
  var byId={}; items.forEach(function(it){byId[it.id]=it;});
  var selecting=false, sel={}, armed=false, armT=null;
  function look(id){var d=nodes[id];if(!d)return;var it=byId[id]||{};
    d.className='it'+(it.f?' fold':'')+(it.f&&it.c?' pic':'')+(it.m?' mini':'')+(sel[id]?' sel':'')+(held[id]?' held':(id===hoverId?' hover':''))+(id===dropId?' drop':'');}
  function count(){return Object.keys(sel).length;}
  function bar(){var b=document.getElementById('delb'), s=document.getElementById('selb');
    s.textContent=selecting?'Done':'Select'; s.className=selecting?'on':'';
    var n=count(); b.style.display=selecting&&n?'':'none'; b.textContent=armed?('Sure? delete '+n):('Delete '+n);
    var m=document.getElementById('movb'), o=document.getElementById('openb');
    if(m){m.style.display=selecting&&n&&FOLDERABLE?'':'none'; m.textContent='Move '+n;}
    var books=Object.keys(sel).filter(function(id){var it=byId[id];return !(it&&it.f);}).length;
    if(o){o.style.display=selecting&&books?'':'none'; o.textContent='Open '+books;}}
  function endSel(){var was=sel;sel={};selecting=false;armed=false;for(var k in was)look(k);bar();send({type:'shelfSelect',key:key,on:false});}
  // Move: the app keeps the picked set while you go to where it should go (tap folders, ⬆), then "Move N here".
  function mv(){var ids=Object.keys(sel).map(function(id){var it=byId[id];return it&&it.f?id:(it&&it.r)||id;});
    if(!ids.length)return; send({type:'moveStart',key:key,ids:ids}); endSel();}
  // Open: each picked book in its own window (folders are skipped — a shelf shows one folder at a time).
  function opn(){var items=Object.keys(sel).filter(function(id){var it=byId[id];return !(it&&it.f);});
    if(!items.length)return; send({type:'openItems',key:key,items:items}); endSel();}
  function toggleSel(){selecting=!selecting; if(!selecting){var was=sel;sel={};for(var k in was)look(k);} armed=false; bar();
    send({type:'shelfSelect',key:key,on:selecting});}
  // Called by the app when a book is tapped in select mode (the 3D book over the spine takes the tap).
  function tapItem(id){if(!selecting)return; if(sel[id])delete sel[id]; else sel[id]=1; armed=false; look(id); bar();}
  function del(){var n=count(); if(!n)return;
    if(!armed){armed=true;bar();clearTimeout(armT);armT=setTimeout(function(){armed=false;bar();},3000);return;}
    var ids=Object.keys(sel).map(function(id){var it=byId[id];return it&&it.f?id:(it&&it.r)||id;});
    send({type:'deleteItems',key:key,ids:ids,items:Object.keys(sel)}); sel={}; armed=false; selecting=false; bar(); draw();
    send({type:'shelfSelect',key:key,on:false});}
  function hold(id,on){if(on)held[id]=1;else delete held[id];look(id);}
  function hover(id){var was=hoverId;hoverId=id;if(was)look(was);if(id)look(id);}
  // Called by the app while a book is carried: 'up' lights the ⬆, an item id lights that folder book, null clears.
  function dropOn(w){var was=dropId;dropId=w;var u=document.getElementById('upb');if(u)u.classList.toggle('drop',w==='up');
    if(was&&was!=='up')look(was);if(w&&w!=='up')look(w);}
  function draw(){
    var box=document.getElementById('rows'); box.innerHTML=''; nodes={};
    document.getElementById('pg').textContent=(q?items.length.toLocaleString()+' of '+all.length.toLocaleString():items.length.toLocaleString())+' · page '+(page+1)+' of '+pages;
    if(!items.length){box.innerHTML='<div id="empty">'+(q?'Nothing here matches “'+q.replace(/</g,'&lt;')+'”.':(FOLDERABLE&&CANUP?'This folder is empty. Drop a book here, ＋📝 for a note, or ⬆ to go back.':'Press ⚙ to choose what this shelf holds.'))+'</div>';return;}
    items.slice(page*per,page*per+per).forEach(function(it,i){
      var r=rects[i], d=document.createElement('div'); nodes[it.id]=d; look(it.id);
      d.style.left=r[0]+'%'; d.style.bottom=r[1]+'%'; d.style.width=r[2]+'%'; d.style.height=r[3]+'%';
      d.style.backgroundColor=asset==='vhs' ? '#151515' : colors[hash(it.t)%colors.length];
      if(it.c) d.style.backgroundImage='url("'+it.c.replace(/"/g,'%22')+'")';
      var s=document.createElement('span'); s.textContent=it.t; d.appendChild(s);
      if(it.f){var c=document.createElement('i'); c.textContent=it.n; d.appendChild(c);}
      d.onclick=function(){ if(selecting) return tapItem(it.id);
        if(it.f) send({type:'openFolder',key:key,folderId:it.id}); else send({type:'open',id:it.id,title:it.t}); };
      box.appendChild(d);
    });
  }
  draw();
</script></body></html>"""
  }


  /** The spine colour of an item, as the shelf page picks it (the 3D book in your hand takes the same one). */
  fun spineColor(title: String): Int {
    var h = 0
    for (ch in title) h = h * 31 + ch.code
    return kotlin.math.abs(h) % SPINE_COLORS.size
  }

  /** Records are wide squares, not spines: their titles can be read from across the room (user, 2026-10-26: "make the
   *  music labels alot bigger on vr"). Artist folders, albums and the mini records of an album's songs alike. */
  private const val RECORD_LABELS = ".it span,.it.mini span{font-size:2.6vh;line-height:1.1;padding:.5vh;max-height:70%;background:rgba(0,0,0,.72)}" +
      ".it.fold i{font-size:2.2vh;top:.6vh;text-shadow:0 0 .6vh #000}"

  /** The card floating over a book / record / tape in your hand: its cover (when it has one) and its title. */
  fun heldCard(title: String, cover: String): String {
    val img = if (cover.isNotEmpty()) """<div id="c" style="background-image:url('${esc(cover)}')"></div>""" else ""
    return """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:Georgia,serif}
  #w{position:absolute;inset:0;display:flex;flex-direction:column;background:rgba(30,20,12,.88);border-radius:3vh;
     border:.6vh solid #ffd27a;box-sizing:border-box;padding:3vh}
  #c{flex:1;background-size:contain;background-repeat:no-repeat;background-position:center;margin-bottom:2vh}
  #t{color:#f4e9d8;font-size:9vh;line-height:1.15;text-align:center;max-height:45vh;overflow:hidden}
</style></head><body><div id="w">$img<div id="t">${esc(title)}</div></div></body></html>"""
  }

  /** The wall clock's face: the time and date, live. */
  fun clock(): String = """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:Georgia,serif}
  #f{position:absolute;inset:2vh;border-radius:50%;background:#f4ecd8;display:flex;flex-direction:column;align-items:center;
     justify-content:center;color:#2b1d12;box-shadow:inset 0 0 3vh rgba(0,0,0,.35)}
  #t{font-size:24vh;letter-spacing:-.5vh}
  #d{font-size:8vh;margin-top:1vh;color:#5e4129}
</style></head><body><div id="f"><div id="t"></div><div id="d"></div></div>
<script>
  function tick(){var n=new Date(), h=n.getHours()%12||12, m=('0'+n.getMinutes()).slice(-2);
    document.getElementById('t').textContent=h+':'+m;
    document.getElementById('d').textContent=n.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});}
  tick(); setInterval(tick, 10000);
</script></body></html>"""

  /** The window's view: a painted landscape shipped in the app (load with base file:///android_asset/). */
  fun windowView(): String = """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#8fb0d0}
img{width:100vw;height:100vh;object-fit:cover;display:block}</style></head>
<body><img src="office/window_view.jpg"></body></html>"""

  /** A record or VHS player waiting: what to drop on it. */
  fun playerIdle(what: String): String = playerCard("Drop a $what here", "", "")

  /** A record playing on the record player (with a stop button), or a tape running on a screen (status only). */
  fun playerCard(title: String, audioSrc: String, stopKey: String, note: String = ""): String {
    val audio = if (audioSrc.isNotEmpty()) """<audio src="${esc(audioSrc)}" autoplay controls></audio>""" else ""
    val stop = if (stopKey.isNotEmpty()) """<button onclick="send({type:'stopPlayer',key:${ja(stopKey)}})">⏹</button>""" else ""
    return """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:Georgia,serif;color:#f4e9d8}
  #w{position:absolute;inset:0;background:rgba(30,20,12,.88);border-radius:4vh;border:.8vh solid #ffd27a;box-sizing:border-box;
     display:flex;flex-direction:column;justify-content:center;padding:2vh 3vw;gap:2vh}
  #r{display:flex;align-items:center;gap:2vw}
  #t{flex:1;font-size:16vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #n{font-size:11vh;color:#d8c39a}
  audio{width:100%;height:24vh}
  button{font-size:16vh;padding:0 3vw;border-radius:2vh;border:1px solid #a88;background:#3a2616;color:#f4e9d8}
</style></head><body><div id="w"><div id="r"><div id="t">${esc(title)}</div>$stop</div>
${if (note.isNotEmpty()) """<div id="n">${esc(note)}</div>""" else ""}$audio</div>
<script>$BRIDGE</script></body></html>"""
  }

  /** A record playing through Spotify's own player (it has no audio file): the title, ⏹, and the player. */
  fun spotifyCard(title: String, embedUrl: String, stopKey: String): String = """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:Georgia,serif;color:#f4e9d8}
  #w{position:absolute;inset:0;background:rgba(30,20,12,.88);border-radius:3vh;border:.6vh solid #ffd27a;box-sizing:border-box;
     display:flex;flex-direction:column;padding:1.6vh 2vw;gap:1.2vh}
  #r{display:flex;align-items:center;gap:2vw}
  #t{flex:1;font-size:4.5vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #n{font-size:3vh;color:#d8c39a}
  iframe{flex:1;min-height:0;width:100%;border:0;border-radius:2vh;background:#121212}
  button{font-size:4.5vh;padding:0 2vw;border-radius:1.5vh;border:1px solid #a88;background:#3a2616;color:#f4e9d8}
</style></head><body><div id="w"><div id="r"><div id="t">${esc(title)}</div><span id="n">Spotify</span>
<button onclick="send({type:'stopPlayer',key:${ja(stopKey)}})">⏹</button></div>
<iframe src="${esc(embedUrl)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen" loading="eager"></iframe></div>
<script>$BRIDGE</script></body></html>"""

  /** A tape running on a screen: the video, with ⏹ to give the screen back its picture. */
  fun video(title: String, src: String, screenKey: String): String = """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;color:#ddd;font-family:sans-serif}
  video{width:100vw;height:100vh;object-fit:contain;display:block}
  #bar{position:fixed;right:1vw;top:1vh;display:flex;gap:1vw;align-items:center}
  #bar span{font-size:4vh;background:rgba(0,0,0,.6);padding:.4vh 1vw;border-radius:1vh}
  button{font-size:4vh;padding:.4vh 1.6vw;border-radius:1vh;border:1px solid #555;background:rgba(20,20,20,.8);color:#eee}
</style></head><body><video src="${esc(src)}" autoplay controls></video>
<div id="bar"><span>${esc(title)}</span><button onclick="send({type:'stopVideo',key:${ja(screenKey)}})">⏹</button></div>
<script>$BRIDGE</script></body></html>"""

  /** A screen: the picture the control panel took of a page or of the grid. */
  fun screen(screen: JSONObject, image: String?): String {
    val id = screen.optString("id")
    val label = screen.optString("label", "Screen")
    val target = if (screen.optString("source") == "grid") "" else screen.optString("pageOccId", "")
    val img = if (image.isNullOrEmpty()) """<div id="wait">${esc(label)}<br><small>picture on its way…</small></div>"""
              else """<img src="${esc(image)}" onclick="send({type:'open',id:${ja(target)},title:${ja(label)}})">"""
    return """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;background:#000;color:#ddd;font-family:sans-serif;overflow:hidden}
  img{width:100vw;height:100vh;object-fit:contain;display:block}
  #wait{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-size:6vh;text-align:center}
  #bar{position:fixed;right:1vw;bottom:1vh;display:flex;gap:1vw}
  button{font-size:4vh;padding:.4vh 1.6vw;border-radius:1vh;border:1px solid #555;background:rgba(20,20,20,.8);color:#eee}
</style></head><body>$img
<div id="bar"><button onclick="send({type:'refreshScreen',id:${ja(id)}})">⟳</button>
<button onclick="send({type:'piece',key:${ja("screen:$id")}})">⚙</button></div>
<script>$BRIDGE</script></body></html>"""
  }
}
