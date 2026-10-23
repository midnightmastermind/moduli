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
  #head b{flex:1;font-size:6vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  button{font-size:5vh;padding:.5vh 2.5vw;border-radius:1vh;border:1px solid #a88;background:#3a2616;color:#f4e9d8}
  #rows{position:relative;height:${100f - headerPct}vh}
  .it{position:absolute;border-radius:.6vh;box-shadow:0 0 .6vh rgba(0,0,0,.6);background-size:cover;background-position:center;
      display:flex;align-items:flex-end;justify-content:center;overflow:hidden;cursor:pointer}
  .it span{font-size:2.6vh;line-height:1.1;padding:.4vh;background:rgba(0,0,0,.55);width:100%;text-align:center;
      max-height:60%;overflow:hidden}
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
  function hold(id,on){if(on)held[id]=1;else delete held[id];draw();}
  function hover(id){hoverId=id;draw();}
  function draw(){
    var box=document.getElementById('rows'); box.innerHTML='';
    document.getElementById('pg').textContent=(page+1)+' / '+pages+' · '+items.length;
    if(!items.length){box.innerHTML='<div id="empty">Press ⚙ to choose what this shelf holds.</div>';return;}
    items.slice(page*per,page*per+per).forEach(function(it,i){
      var r=rects[i], d=document.createElement('div'); d.className='it'+(held[it.id]?' held':(it.id===hoverId?' hover':''));
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
