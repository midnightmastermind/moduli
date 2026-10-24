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
  fun shelf(shelf: JSONObject, slots: List<ShelfLayout.Slot>, shelfHeightM: Float, page: Int): String {
    val id = shelf.optString("id")
    val asset = shelf.optString("asset", "book")
    val title = shelf.optString("title", "Shelf")
    val items: JSONArray = shelf.optJSONArray("items") ?: JSONArray()
    val headerPct = HEADER_M / (shelfHeightM + HEADER_M) * 100f
    val data = JSONArray()
    for (i in 0 until items.length()) {
      val it = items.getJSONObject(i)
      data.put(JSONObject().put("id", it.optString("id")).put("t", it.optString("title")).put("c", it.optString("cover", "")))
    }
    val rects = JSONArray()
    for (sl in slots) rects.put(JSONArray().put(sl.leftPct.toDouble()).put(sl.bottomPct.toDouble()).put(sl.wPct.toDouble()).put(sl.hPct.toDouble()))
    return """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;background:transparent;font-family:Georgia,serif;color:#f4e9d8;overflow:hidden}
  #head{height:${headerPct}vh;display:flex;align-items:center;gap:2vw;padding:0 2vw;box-sizing:border-box;background:rgba(40,26,16,.82);border-radius:1.5vh}
  /* Small enough that a shelf's name fits beside its buttons (it showed "Boo…"). */
  #head b{flex:1;font-size:3vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #pg{font-size:2.2vh;white-space:nowrap}
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
  #empty{padding:4vh 4vw;font-size:4.5vh;background:rgba(0,0,0,.5);margin:3vh;border-radius:1vh}
</style></head><body>
<div id="head"><b>${esc(title)}</b><span id="pg"></span>
  <button onclick="go(-1)">◀</button><button onclick="go(1)">▶</button>
  <button onclick="send({type:'piece',key:${js("shelf:$id")}})">⚙</button></div>
<div id="rows"></div>
<script>$BRIDGE
  var items=$data, rects=$rects, asset=${js(asset)}, key=${js("shelf:$id")};
  var colors=${JSONArray(SPINE_COLORS)};
  function hash(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h);}
  var per=rects.length, pages=Math.max(1,Math.ceil(items.length/per)), page=Math.min($page,pages-1), held={}, hoverId=null;
  function go(d){page=(page+d+pages)%pages;draw();send({type:'shelfPage',key:key,page:page});}
  // Pointing and holding change ONE spine's look, never the page: draw() rebuilds every spine and reloads every
  // cover, which made pointing along a shelf lag (it ran on each move from one book to the next).
  var nodes={};
  function look(id){var d=nodes[id];if(d)d.className='it'+(held[id]?' held':(id===hoverId?' hover':''));}
  function hold(id,on){if(on)held[id]=1;else delete held[id];look(id);}
  function hover(id){var was=hoverId;hoverId=id;if(was)look(was);if(id)look(id);}
  function draw(){
    var box=document.getElementById('rows'); box.innerHTML=''; nodes={};
    document.getElementById('pg').textContent=items.length.toLocaleString()+' · page '+(page+1)+' of '+pages;
    if(!items.length){box.innerHTML='<div id="empty">Press ⚙ to choose what this shelf holds.</div>';return;}
    items.slice(page*per,page*per+per).forEach(function(it,i){
      var r=rects[i], d=document.createElement('div'); nodes[it.id]=d; look(it.id);
      d.style.left=r[0]+'%'; d.style.bottom=r[1]+'%'; d.style.width=r[2]+'%'; d.style.height=r[3]+'%';
      d.style.backgroundColor=asset==='vhs' ? '#151515' : colors[hash(it.t)%colors.length];
      if(it.c) d.style.backgroundImage='url("'+it.c.replace(/"/g,'%22')+'")';
      var s=document.createElement('span'); s.textContent=it.t; d.appendChild(s);
      d.onclick=function(){send({type:'open',id:it.id,title:it.t});};
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
    val stop = if (stopKey.isNotEmpty()) """<button onclick="send({type:'stopPlayer',key:${js(stopKey)}})">⏹</button>""" else ""
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

  /** A tape running on a screen: the video, with ⏹ to give the screen back its picture. */
  fun video(title: String, src: String, screenKey: String): String = """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;color:#ddd;font-family:sans-serif}
  video{width:100vw;height:100vh;object-fit:contain;display:block}
  #bar{position:fixed;right:1vw;top:1vh;display:flex;gap:1vw;align-items:center}
  #bar span{font-size:4vh;background:rgba(0,0,0,.6);padding:.4vh 1vw;border-radius:1vh}
  button{font-size:4vh;padding:.4vh 1.6vw;border-radius:1vh;border:1px solid #555;background:rgba(20,20,20,.8);color:#eee}
</style></head><body><video src="${esc(src)}" autoplay controls></video>
<div id="bar"><span>${esc(title)}</span><button onclick="send({type:'stopVideo',key:${js(screenKey)}})">⏹</button></div>
<script>$BRIDGE</script></body></html>"""

  /** A screen: the picture the control panel took of a page or of the grid. */
  fun screen(screen: JSONObject, image: String?): String {
    val id = screen.optString("id")
    val label = screen.optString("label", "Screen")
    val target = if (screen.optString("source") == "grid") "" else screen.optString("pageOccId", "")
    val img = if (image.isNullOrEmpty()) """<div id="wait">${esc(label)}<br><small>picture on its way…</small></div>"""
              else """<img src="${esc(image)}" onclick="send({type:'open',id:${js(target)},title:${js(label)}})">"""
    return """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;background:#000;color:#ddd;font-family:sans-serif;overflow:hidden}
  img{width:100vw;height:100vh;object-fit:contain;display:block}
  #wait{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-size:6vh;text-align:center}
  #bar{position:fixed;right:1vw;bottom:1vh;display:flex;gap:1vw}
  button{font-size:4vh;padding:.4vh 1.6vw;border-radius:1vh;border:1px solid #555;background:rgba(20,20,20,.8);color:#eee}
</style></head><body>$img
<div id="bar"><button onclick="send({type:'refreshScreen',id:${js(id)}})">⟳</button>
<button onclick="send({type:'piece',key:${js("screen:$id")}})">⚙</button></div>
<script>$BRIDGE</script></body></html>"""
  }
}
