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

const initXr = (global: Global) => {
    const { app, events, state, camera } = global;

    // Check if 8th Wall is available
    const has8thWall = typeof window.XR8 !== 'undefined';

    // Also check native WebXR for Android (can use either)
    state.hasAR = has8thWall || (app.xr?.isAvailable?.('immersive-ar') ?? false);
    state.hasVR = app.xr?.isAvailable?.('immersive-vr') ?? false;
    dbg(`[XR init] has8thWall=${has8thWall}, hasAR=${state.hasAR}, hasVR=${state.hasVR}`);

    if (!has8thWall) {
        dbg('[XR] 8th Wall not loaded, AR disabled');
        return;
    }

    let arActive = false;
    let arPlaced = false;
    let gsplatEntity: Entity | null = null;
    let reticle: Entity | null = null;

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
                const { position } = processCpuResult.reality;

                // Use camera position as approximate ground point for reticle
                // 8th Wall places the ground at y=0
                if (reticle && !arPlaced) {
                    reticle.enabled = true;
                    // Project reticle to ground plane in front of camera
                    const cam = camera.getPosition();
                    const fwd = camera.forward;
                    // Place reticle 1.5m in front of camera on ground (y=0)
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

                // Re-show canvas
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

    // Start AR with 8th Wall
    const startAR = () => {
        dbg('[8thWall] starting AR...');

        const pcCamera = camera;
        const pcApp = app;
        const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;

        try {
            // Configure XR controller
            window.XR8.XrController.configure({
                disableWorldTracking: false,
                scale: 'absolute'
            });

            // Run with PlayCanvas integration
            window.XR8.PlayCanvas.run(
                { pcCamera, pcApp },
                [
                    window.XR8.XrController.pipelineModule(),
                    gsplatPipelineModule(),
                    window.XRExtras?.Loading?.pipelineModule?.(),
                    window.XRExtras?.RuntimeError?.pipelineModule?.(),
                ].filter(Boolean)
            );

            dbg('[8thWall] XR8.PlayCanvas.run() called');
        } catch (err: any) {
            dbg(`[8thWall] ERROR: ${err.message}`);
        }
    };

    const stopAR = () => {
        dbg('[8thWall] stopping AR...');
        try {
            window.XR8.stop();
        } catch (err: any) {
            dbg(`[8thWall] stop error: ${err.message}`);
        }
    };

    // Exit button
    const exitBtn = document.createElement('button');
    exitBtn.textContent = 'EXIT AR';
    exitBtn.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);padding:16px 32px;font-size:20px;font-weight:bold;background:#ff4444;color:#fff;border:none;border-radius:12px;cursor:pointer;z-index:99999;display:none;';
    exitBtn.addEventListener('click', () => {
        stopAR();
        exitBtn.style.display = 'none';
    });
    document.body.appendChild(exitBtn);

    // AR button
    const arBtn = document.createElement('button');
    arBtn.textContent = 'START AR';
    arBtn.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;padding:20px 40px;font-size:24px;font-weight:bold;background:#7B72FF;color:#fff;border:none;border-radius:12px;cursor:pointer;';
    arBtn.addEventListener('click', () => {
        startAR();
        exitBtn.style.display = 'block';
        arBtn.style.display = 'none';
    });
    document.body.appendChild(arBtn);

    events.on('startAR', () => {
        startAR();
        exitBtn.style.display = 'block';
        arBtn.style.display = 'none';
    });

    events.on('inputEvent', (event) => {
        if (event === 'cancel' && arActive) {
            stopAR();
            exitBtn.style.display = 'none';
            arBtn.style.display = 'block';
        }
    });
};

export { initXr };
