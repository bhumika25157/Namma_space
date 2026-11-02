# How to open the NammaSpace viewer on your computer

The viewer must be served by a small local web server. Double-clicking `site/index.html` shows a blank page because browsers block 3D models and scripts opened as local files.
(Or just use the online version: https://bhumika25157.github.io/Namma_space/)

## Windows
1. **Install Node.js (one time):** download the **LTS** installer from https://nodejs.org and click **Next** through the defaults.
2. **Get the project:** on GitHub click **Code → Download ZIP**, then right-click the zip → **Extract All… → Extract**. Open the extracted folder until you see `site`, `video` and `README.md`.
3. **Open a command window there:** click the folder's address bar, type `cmd`, press **Enter**.
4. **Start the viewer:** type the command below and press **Enter**. Keep the window open. If Windows Firewall asks about Node.js, you can click Cancel.
   ```
   node video/serve.mjs site 8765
   ```
5. **Open** http://localhost:8765 in Chrome or Edge and wait for the loading bar (~15 MB model).
6. **Stop:** close the command window (or press Ctrl + C).

## Mac
Install Node.js from https://nodejs.org (`.pkg`), download and unzip the project, open **Terminal**, type `cd ` (with a space), drag the project folder into Terminal, press **Enter**, then run step 4 and open http://localhost:8765.

## Controls
- **Explore:** drag = orbit · scroll = zoom · right-drag = pan · double-click = focus
- **Walk:** W A S D = move · drag = look around · Shift = faster · Q/E = down/up
- **Sparse / Dense / Mesh / Textured:** the stages of the reconstruction · **About:** data source and statistics · **F:** fullscreen

## Problems?
- `'node' is not recognized`: install Node.js, then open a new command window.
- `Cannot find module … serve.mjs`: you're in the wrong folder. It must directly contain `site` and `video`.
- `EADDRINUSE`: port busy. Run `node video/serve.mjs site 8766` and open http://localhost:8766.
