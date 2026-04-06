new bugs


Drag n Drop
- add delete button to radial menu *nothing happens when i click 
- radial menu is opening off screen, in that event. just do a line, going along the edge instead of a circle (if the radial menu buttons open off screen) *i need all the radial menu buttons to line up (not just the ones off screen) 
- deleting an occurance is deleting all of them. (should only delete that one) *still happening
- highlighting over containers (with instances) is sputtering like crazy *still happening
- cant drag/drop out of docs into other containers *still not working
- the turn into an module (doesnt need to show up if im dragging in a module already, just ask if i want a pill or embed) *the button is working but the preview shows up as a pill (and if i select pill instead of embed, it creates another pill as well as the placeholder), default it to embed and not pill. and the input that pops up needs to be less transparent. we need an option in radialmenu to switch between the pill and the embed for that module. 

docs
- when i click on a container or page or any module with text in it, i need the texting cursor (where the focus is) on where i click. right now it goes to the beginning of the textmap. it should go where i click. *this is still happening. clicking on the doc, sends me to the very first line, instead of the line im on (it needs to go on the empty line im on) and click in the middle of text. should put that cursor inside the text, at that position. like obsidian or any other document editor. it needs to place the typing indicator in the spot i clicked (or at the beginning of the line i clicked, in the event its empty. ) this goes for text inside containers and inside doc pages normally. if i click inside of a doc with text in its body, it sends me to the very first line of that container and not in the position i want. please fix this.

operations
- deleting occurances from the schedule is not rerunning the operations like it should. *this is working. i want to make sure we are using an onDelete operation trigger. or onRemove actually. it should rerun the operations. (we need to make sure the pipelines calculations of this is sound and will not count the removed element anymore)

files/manifest
- dragging a windows file in (image, doc, or video), isnt doing anything. i expect an artifact module gets created in the spot i drop and the file uploaded. ask if i want it to be a preview or a embed (preview is the previewnode, embed would be embending the artifact into the board, doc, canvas, or container). if i drag it into a folder, make sure it becomes a previewnode module
- root isnt showing as a folder window when i click on it and folders dont have a previewnode at the moment for being inside a folder (it should)
- i cant drag and drop around the manifest trees or reorder. they arent draggable. those nodes should be draggable and droppable inside the tree. 
- pages keep reloading as preview nodes. they will show up and then keep reloading cause for some reason they lose occurences.
- i was trying to implement this: instead of loading the entire app for the preview. do i a full request with that previewOcc and only return the occurences and data necessary to load that module. 
