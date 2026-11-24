# SmartGrid 3D Digital Twin

The application now has a dedicated **3D Digital Twin** page in the left navigation.

## What it contains
- A roof-open 3D property model built from separate room floors, walls, and equipment/furniture geometry.
- Campus and Residential profiles are populated from the active backend area list.
- Each room is coloured according to its configured peak threshold: normal, elevated, or threshold exceeded.
- A central simulated meter hub sends animated energy pulses toward each room.
- Selecting a room displays its daily energy, peak demand, threshold status, and equipment allocation.
- The room selection is linked to the existing Areas & equipment editor.

## Controls
- Drag: rotate the model.
- Mouse wheel / trackpad scroll: zoom.
- Click a room: select and inspect it.
- Reset view: restore the initial camera angle and zoom.

## Technical note
The 3D scene is rendered locally using browser canvas drawing with perspective-projected 3D geometry. It has no Three.js, WebGL, CDN, or additional npm dependency, so it works with the existing Java static-file server and does not require internet access. It is an interactive 3D visualization, not a photorealistic BIM model or a physical building scan.

All room readings and energy pulses remain simulated academic-prototype data. No physical meter, IoT device, or building system is connected.
