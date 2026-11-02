# Namma Space – Smartphone-to-Web Indoor Reconstruction & Roaming

**Demo:** https://aryan2159.github.io/namma-space-3d/  ·  **Team:** Aryan Malik (IIIT Delhi)

**Problem.** Indoor spaces such as labs, hostels and campus buildings have no navigable digital twin. Existing tools need LiDAR phones, paid cloud services or manual modelling.

**Approach.** We built a fully open-source, CPU-only pipeline that turns one handheld smartphone video into a textured, walkable 3D model served as a static web page.
1. *Frame selection:* ffmpeg `blurdetect` scores every candidate frame and keeps the sharpest frame in each time window, which suppresses motion blur (the main failure mode indoors).
2. *Structure-from-Motion:* COLMAP 4.2 extracts SIFT features and matches frames sequentially, with vocabulary-tree loop closure. Incremental bundle adjustment then recovers each frame's 6-DoF pose and a sparse point cloud. We gravity-align the result using an upright-camera prior.
3. *Multi-View Stereo:* OpenMVS 2.4 estimates and fuses per-view depth maps into a dense cloud. It then extracts a watertight-ish surface with Delaunay tetrahedralisation and graph-cut, and textures it from the best views as a single GLB.
4. *Optional photoreal layer (experimental):* Brush trains 3D Gaussian splats from the same poses on a non-NVIDIA integrated GPU (wgpu), running in parallel with the CPU-bound MVS stage. The viewer shows a Photoreal toggle when a splat file is present.
5. *Web delivery:* glTF-Transform compresses the model (meshopt geometry, WebP textures). A three.js viewer infers the floor plane and metric scale from the recovered camera heights and offers three modes. *Explore* is a dollhouse view with ceiling cutaway. *Walk* is first-person roaming with BVH-accelerated collision, click-to-step and a touch joystick. *Tour* replays the real capture trajectory.

**Results.** The demo scene is a computer lab, reconstructed from a single 9.6 s handheld clip (1024×576, WhatsApp-compressed) with no manual editing.
- **SfM:** COLMAP registered 95 of 136 selected frames at **0.87 px** mean reprojection error.
- **Dense and mesh:** OpenMVS fused **380k** dense points into a **159k-triangle** textured mesh (2048² atlas), delivered as a **1.7 MB** GLB that loads in under 4 s on the public URL.
- **Runtime:** **16.9 min** end to end on a laptop CPU (Ryzen 7 7730U, no CUDA).

The viewer's **About** panel shows these figures, read from files the pipeline writes.

**Novelty / practicality.** Zero cost, with no special hardware, no accounts and no proprietary SDKs. One script runs from video to deployable URL. The output is a measurable, collision-aware mesh, not just a picture, so it is a ready base for POI tagging and indoor navigation in later rounds.

**Limitations & next steps.** Scale is approximate (from assumed phone height). The demo clip mostly pans from one spot, so only surfaces facing the phone are reconstructed. A 60–90 s walking capture (see the Capture SOP) covers the whole room. Featureless walls, glass and mirrors reduce completeness. The Gaussian-splat stage runs, but it grew only ~9k splats from this short clip, so it is not shown. Next we plan metric scale from a reference object or ARCore depth, semantic room segmentation, and A* navigation on the floor mesh.
