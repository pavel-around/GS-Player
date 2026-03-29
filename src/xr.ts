import {
    Color,
    Entity,
    Quat,
    StandardMaterial,
    Vec3,
    type CameraComponent
} from 'playcanvas';

import { Global } from './types';

// Declare 8th Wall globals
declare global {
    interface Window {
        XR8: any;
        XRExtras: any;
    }
}

// On-screen debug overlay
const debugLines: string[] = [];
let debugEl: HTMLDivElement | null = null;

const dbg = (msg: string) => {
    console.log(msg);
    debugLines.push(`${new Date().toLocaleTimeString()} ${msg}`);
    if (debugLines.length > 20) debugLines.shift();
    if (!debugEl) {
        debugEl = document.createElement('div');
        debugEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:rgba(0,0,0,0.7);color:#0f0;font:12px monospace;padding:8px;max-height:40vh;overflow-y:auto;pointer-events:none;';
        document.body.appendChild(debugEl);
    }
    debugEl.textContent = debugLines.join('\n');
};

// Load a script dynamically, returns a promise
const loadScript = (src: string, attrs?: Record<string, string>): Promise<void> => {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        if (attrs) Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
    });
};

// Wait for window.XR8 to be defined (xr.js loads async)
const waitForXR8 = (): Promise<void> => {
    return new Promise((resolve) => {
        if (window.XR8) { resolve(); return; }
        window.addEventListener('xrloaded', () => resolve(), { once: true });
    });
};

const initXr = (global: Global) => {
    const { app, events, state, camera } = global;

    // Always show AR button on mobile — 8th Wall works everywhere
    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    state.hasAR = isMobile;
    state.hasVR = false;
    dbg(`[XR init] isMobile=${isMobile}, hasAR=${state.hasAR}`);

    let arActive = false;
    let arPlaced = false;
    let gsplatEntity: Entity | null = null;
    let reticle: Entity | null = null;
    let xr8Loaded = false;

    // Save original state for restoration
    const savedClearColor = new Color();
    const savedCameraPos = new Vec3();
    const savedCameraRot = new Quat();
    const savedParentPos = new Vec3();
    const savedParentRot = new Quat();

    const parent = camera.parent as Entity;

    const buildReticle = () => {
        const entity = new Entity('ar-reticle');
        const mat = new StandardMaterial();
        mat.diffuse = new Color(1, 1, 1);
        mat.emissive = new Color(0.5, 0.5, 0.5);
        mat.opacity = 0.7;
        mat.blendType = 2;
        mat.depthWrite = false;
        mat.update();
        entity.addComponent('render', { type: 'plane', material: mat });
        entity.setLocalScale(0.15, 0.15, 0.15);
        entity.enabled = false;
        app.root.addChild(entity);
        return entity;
    };

    // Custom pipeline module to place gsplat
    const gsplatPipelineModule = () => {
        return {
            name: 'gsplat-placement',
            onStart: () => {
                dbg('[8thWall] pipeline started');
                arActive = true;
                arPlaced = false;
                app.autoRender = true;

                // Save state
                savedClearColor.copy(camera.camera.clearColor);
                savedCameraPos.copy(camera.getPosition());
                savedCameraRot.copy(camera.getRotation());
                savedParentPos.copy(parent.getPosition());
                savedParentRot.copy(parent.getRotation());

                // Hide gsplat until placed
                gsplatEntity = app.root.findByName('gsplat') as Entity | null;
                if (gsplatEntity) gsplatEntity.enabled = false;

                // Build reticle
                if (!reticle) reticle = buildReticle();
                reticle.enabled = false;

                // Transparent background for AR
                camera.camera.clearColor = new Color(0, 0, 0, 0);
            },
            onUpdate: ({ processCpuResult }: any) => {
                if (!processCpuResult?.reality) return;

                // 8th Wall places the ground at y=0
                if (reticle && !arPlaced) {
                    reticle.enabled = true;
                    // Project reticle to ground plane in front of camera
                    const cam = camera.getPosition();
                    const fwd = camera.forward;
                    reticle.setPosition(
                        cam.x + fwd.x * 1.5,
                        0,
                        cam.z + fwd.z * 1.5
                    );
                }
            },
            onDetach: () => {
                dbg('[8thWall] pipeline detached');
                arActive = false;
                arPlaced = false;
                app.autoRender = false;

                // Restore gsplat
                if (gsplatEntity) {
                    gsplatEntity.enabled = true;
                    gsplatEntity.setLocalScale(1, 1, 1);
                    gsplatEntity.setPosition(0, 0, 0);
                    gsplatEntity.setLocalEulerAngles(0, 0, 180);
                }

                // Restore camera
                camera.camera.clearColor = savedClearColor;
                camera.setPosition(savedCameraPos);
                camera.setRotation(savedCameraRot);
                parent.setPosition(savedParentPos);
                parent.setRotation(savedParentRot);

                if (reticle) reticle.enabled = false;

                requestAnimationFrame(() => {
                    document.body.prepend(app.graphicsDevice.canvas);
                    app.renderNextFrame = true;
                });
            }
        };
    };

    // Touch handler for placing gsplat
    const onTouch = (e: TouchEvent) => {
        if (!arActive) return;
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        if (!reticle || !reticle.enabled) return;

        if (!gsplatEntity) gsplatEntity = app.root.findByName('gsplat') as Entity | null;
        if (!gsplatEntity) {
            dbg('[8thWall] gsplat entity not found');
            return;
        }

        const rp = reticle.getPosition();
        gsplatEntity.setPosition(rp.x, rp.y, rp.z);
        gsplatEntity.setLocalScale(0.15, 0.15, 0.15);
        gsplatEntity.setLocalEulerAngles(0, 0, 0);
        gsplatEntity.enabled = true;
        arPlaced = true;
        dbg(`[8thWall] PLACED splat at ${rp.x.toFixed(2)},${rp.y.toFixed(2)},${rp.z.toFixed(2)}`);
    };

    document.addEventListener('touchstart', onTouch);

    // Load 8th Wall scripts on demand, then start AR
    const loadAndStartAR = async () => {
        dbg('[8thWall] loading scripts...');
        arBtn.textContent = 'Loading...';
        arBtn.style.pointerEvents = 'none';

        try {
            if (!xr8Loaded) {
                // Load xrextras first (sync dependency)
                await loadScript('./8thwall/xrextras.js');
                dbg('[8thWall] xrextras loaded');

                // Load xr.js with SLAM preload
                await loadScript('./8thwall/xr.js', { 'data-preload-chunks': 'slam' });
                dbg('[8thWall] xr.js script added');

                // Wait for XR8 to initialize
                await waitForXR8();
                dbg('[8thWall] XR8 ready');

                xr8Loaded = true;
            }

            // Configure (only before first run)
            if (!xr8Loaded) {
                window.XR8.XrController.configure({
                    disableWorldTracking: false,
                    scale: 'absolute'
                });
            }

            const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
            dbg(`[8thWall] canvas=${canvas.id} ${canvas.width}x${canvas.height}`);

            // PlayCanvas integration handles camera feed rendering internally
            window.XR8.PlayCanvas.run(
                { pcCamera: camera, pcApp: app, canvas },
                [
                    window.XR8.XrController.pipelineModule(),
                    gsplatPipelineModule(),
                ].filter(Boolean)
            );

            dbg('[8thWall] AR started');
            exitBtn.style.display = 'block';
            arBtn.style.display = 'none';
        } catch (err: any) {
            dbg(`[8thWall] ERROR: ${err.message}`);
            arBtn.textContent = 'START AR';
            arBtn.style.pointerEvents = 'auto';
        }
    };

    const stopAR = () => {
        dbg('[8thWall] stopping AR...');
        try {
            window.XR8.stop();
        } catch (err: any) {
            dbg(`[8thWall] stop error: ${err.message}`);
        }
        exitBtn.style.display = 'none';
        arBtn.style.display = 'block';
        arBtn.textContent = 'START AR';
        arBtn.style.pointerEvents = 'auto';
    };

    // Exit button
    const exitBtn = document.createElement('button');
    exitBtn.textContent = 'EXIT AR';
    exitBtn.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);padding:16px 32px;font-size:20px;font-weight:bold;background:#ff4444;color:#fff;border:none;border-radius:12px;cursor:pointer;z-index:99999;display:none;';
    exitBtn.addEventListener('click', stopAR);
    document.body.appendChild(exitBtn);

    // AR button
    const arBtn = document.createElement('button');
    arBtn.textContent = 'START AR';
    arBtn.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;padding:20px 40px;font-size:24px;font-weight:bold;background:#7B72FF;color:#fff;border:none;border-radius:12px;cursor:pointer;';
    arBtn.addEventListener('click', loadAndStartAR);
    document.body.appendChild(arBtn);

    events.on('startAR', loadAndStartAR);

    events.on('inputEvent', (event) => {
        if (event === 'cancel' && arActive) {
            stopAR();
        }
    });
};

export { initXr };
