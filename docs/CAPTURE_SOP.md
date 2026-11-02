# Capture SOP – smartphone video → 3D room (COLMAP + OpenMVS)

**Goal:** about 60–90 s of sharp, overlapping footage in which the camera *moves through* the space. Photogrammetry needs **parallax**: the same object seen from different positions.

## Before recording (1 min)
1. Switch on **all lights**. Close blinds against harsh sun patches. Turn off ceiling fans and screens that flicker or animate.
2. Clear people and pets out of the room. **Nothing may move during capture.**
3. Wipe the lens. Set the camera to **1080p or 4K, 30 fps, landscape**. Turn off HDR video, stabilisation "Active" or "Cinematic" modes, and beauty filters.
4. If possible, lock exposure/focus by long-pressing on a mid-tone surface (AE/AF lock).

## Recording path (60–90 s)
1. **Perimeter loop at chest height (~1.3–1.4 m).** Walk slowly, about half a step per second, along the walls. Point the phone **across the room** or diagonally at the opposite wall, never straight down the corridor you are walking along.
2. **Second loop, higher and tilted ~20° down.** This captures desk/table tops and the floor.
3. **Close passes, 0.5–1 m from interesting objects** (desk, shelf, notice board). Sweep sideways past them rather than turning on the spot.
4. **End where you started** so the loop closes.

## Do / don't
| Do | Don't |
|---|---|
| Translate (walk) while filming | Stand still and spin in place: zero parallax, so reconstruction fails |
| Keep textured things in frame (furniture, posters, boards) | Fill the frame with blank walls, ceiling, mirrors, glass or windows |
| Move smoothly; pause briefly at corners | Whip-pan (it causes motion blur, the #1 cause of failure indoors) |
| Overlap each view by ~70 % with the previous one | Jump between distant spots |

## Getting the file to the PC
Use the **original file**: USB cable (DCIM/Camera), Google Drive/OneDrive upload, or WhatsApp → 📎 **Document**.
A normal WhatsApp *video* send re-encodes to ~1024×576 and destroys fine detail.

Put it in `NammaSpace/capture/` and run:

```bash
bash pipeline/reconstruct.sh "capture/<video>.mp4" my_room 160
bash pipeline/publish_scene.sh my_room my-room real "My room" "Smartphone video, <date>" "<provenance>" --default
```

Photos also work: put 80–150 overlapping landscape JPGs in a folder and pass the folder instead of the video.

## Quick quality check
`work/<job>/sfm_stats.txt` should show that **> 80 % of frames registered**, with mean reprojection error **< 1.5 px**. If many frames failed, re-shoot with slower motion and more texture in view.
