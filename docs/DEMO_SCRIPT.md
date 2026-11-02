# Demo script (≈4 min) – Namma Space: 3D Reconstruction & Roaming

**URL:** https://aryan2159.github.io/namma-space-3d/

| Time | On screen | Say |
|---|---|---|
| 0:00–0:25 | Landing view (Explore mode, ceiling cut away) | "This is a computer lab I filmed, rebuilt from a single 9.6-second phone video. No CAD and no manual modelling: every surface you see was reconstructed from the video frames." |
| 0:25–0:55 | Drag to orbit, scroll to zoom, double-click a desk to focus | "Explore mode is a dollhouse view. The ceiling is cut away so you can see the layout. Double-click any surface to focus on it. Reset brings back the overview." |
| 0:55–1:30 | Click **Camera path** | "The orange line and the green frustums are the actual phone positions recovered by Structure-from-Motion. COLMAP solved for every frame's position and orientation from image features alone, with no sensors or IMU." |
| 1:30–2:30 | **Walk** mode: W/A/S/D, drag to look, double-click the floor to step, walk into a wall | "Walk mode is free roaming at eye height. Collision uses a BVH over the reconstructed mesh, so you can't walk through walls or desks. Double-clicking steps you there; on a phone you get a joystick." |
| 2:30–3:05 | **Tour** mode, 2× speed | "Tour replays the real capture trajectory, smoothed, so a first-time visitor gets a guided walkthrough automatically." |
| 3:05–3:50 | **About** panel | "The whole pipeline is open source and CPU-only: ffmpeg frame selection, COLMAP, OpenMVS, glTF-Transform and three.js. COLMAP registered 95 of 136 frames at 0.87-pixel reprojection error. OpenMVS built a 159-thousand-triangle textured mesh. It runs end to end in 17 minutes on a laptop CPU, and the whole model is 1.7 MB, hosted for free on GitHub Pages." |
| 3:50–4:10 | Back to overview, orbit to the gap at the right | "A 10-second pan only sees one side, which is why some areas are missing. Our capture guide's 60-to-90-second walking loop fills them in, using the same one-command pipeline." |
| 4:10–4:30 | Back to overview | "Next steps: metric scale from a known object, room segmentation, and POI search and navigation on top of this walkable mesh." |

**Tips:** do a full dry run first and leave the page open so it's cached. If the venue Wi-Fi is slow, first-load size is shown on the loading bar.
