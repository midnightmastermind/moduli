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

  /** A shelf: its items on the shelf boards (the wooden frame is drawn behind the panel), paged. */
  fun shelf(shelf: JSONObject, rows: Int, shelfHeightM: Float): String {
    val id = shelf.optString("id")
    val asset = shelf.optString("asset", "book")
    val title = shelf.optString("title", "Shelf")
    val items: JSONArray = shelf.optJSONArray("items") ?: JSONArray()
    val headerPct = HEADER_M / (shelfHeightM + HEADER_M) * 100f
    val perRow = when (asset) { "record" -> 3; "vhs" -> 9; else -> 8 }
    val data = JSONArray()
    for (i in 0 until items.length()) {
      val it = items.getJSONObject(i)
      data.put(JSONObject().put("id", it.optString("id")).put("t", it.optString("title")).put("c", it.optString("cover", "")))
    }
    return """<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  html,body{margin:0;height:100%;background:transparent;font-family:Georgia,serif;color:#f4e9d8;overflow:hidden}
  #head{height:${headerPct}vh;display:flex;align-items:center;gap:2vw;padding:0 2vw;box-sizing:border-box;background:rgba(40,26,16,.82);border-radius:1.5vh}
  #head b{flex:1;font-size:6vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  button{font-size:5vh;padding:.5vh 2.5vw;border-radius:1vh;border:1px solid #a88;background:#3a2616;color:#f4e9d8}
  #rows{height:${100f - headerPct}vh;display:flex;flex-direction:column}
  .row{flex:1;display:flex;align-items:flex-end;gap:.6vw;padding:0 3vw 1.2vh;box-sizing:border-box}
  .it{flex:0 0 auto;border-radius:.6vh;box-shadow:0 0 .6vh rgba(0,0,0,.6);background-size:cover;background-position:center;
      display:flex;align-items:flex-end;justify-content:center;overflow:hidden;cursor:pointer}
  .it span{font-size:2.6vh;line-height:1.1;padding:.4vh;background:rgba(0,0,0,.55);width:100%;text-align:center;
      max-height:60%;overflow:hidden}
  .it:active{transform:translateZ(0) scale(1.06)}
  #empty{padding:4vh 4vw;font-size:4.5vh;background:rgba(0,0,0,.5);margin:3vh;border-radius:1vh}
</style></head><body>
<div id="head"><b>${esc(title)}</b><span id="pg"></span>
  <button onclick="go(-1)">◀</button><button onclick="go(1)">▶</button>
  <button onclick="send({type:'select',key:${js("shelf:$id")}})">⚙</button></div>
<div id="rows"></div>
<script>$BRIDGE
  var items=${data}, rows=$rows, perRow=$perRow, asset=${js(asset)}, page=0;
  var colors=${JSONArray(SPINE_COLORS)};
  function hash(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h);}
  var per=rows*perRow, pages=Math.max(1,Math.ceil(items.length/per));
  function go(d){page=(page+d+pages)%pages;draw();}
  function draw(){
    var box=document.getElementById('rows'); box.innerHTML='';
    document.getElementById('pg').textContent=(page+1)+' / '+pages+' · '+items.length;
    if(!items.length){box.innerHTML='<div id="empty">Press ⚙ to choose what this shelf holds.</div>';return;}
    var slice=items.slice(page*per,page*per+per);
    for(var r=0;r<rows;r++){
      var row=document.createElement('div'); row.className='row'; box.appendChild(row);
      slice.slice(r*perRow,r*perRow+perRow).forEach(function(it){
        var d=document.createElement('div'); d.className='it';
        var w = asset==='record' ? '24vw' : asset==='vhs' ? '8vw' : '10vw';
        var h = asset==='record' ? '24vw' : '85%';
        d.style.width=w; d.style.height=h;
        d.style.backgroundColor=asset==='vhs' ? '#151515' : colors[hash(it.t)%colors.length];
        if(it.c) d.style.backgroundImage='url("'+it.c.replace(/"/g,'%22')+'")';
        var s=document.createElement('span'); s.textContent=it.t; d.appendChild(s);
        d.onclick=function(){send({type:'open',id:it.id,title:it.t});};
        row.appendChild(d);
      });
    }
  }
  draw();
</script></body></html>"""
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
<button onclick="send({type:'select',key:${js("screen:$id")}})">⚙</button></div>
<script>$BRIDGE</script></body></html>"""
  }
}
