import {
    Color,
    Entity,
    Mat4,
    Quat,
    StandardMaterial,
    Vec3,
} from 'playcanvas';

import { Global } from './types';

declare global {
    interface Window {
        XR8: any;
        XRExtras: any;
    }
}

const debugLines: string[] = [];
let debugEl: HTMLDivElement | null = null;

const dbg = (msg: string) => {
    console.log(msg);
    debugLines.push(`${new Date().toLocaleTimeString()} ${msg}`);
    if (debugLines.length > 30) debugLines.shift();
    if (!debugEl) {
        debugEl = document.createElement('div');
        debugEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:rgba(0,0,0,0.7);color:#0f0;font:12px monospace;padding:8px;max-height:40vh;overflow-y:auto;pointer-events:none;';
        document.body.appendChild(debugEl);
    }
    debugEl.textContent = debugLines.join('\n');
};

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

const waitForXR8 = (): Promise<void> => {
    return new Promise((resolve) => {
        if (window.XR8) { resolve(); return; }
        window.addEventListener('xrloaded', () => resolve(), { once: true });
    });
};

const initXr = (global: Global) => {
    const { app, events, state, camera } = global;

    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    state.hasAR = isMobile;
    state.hasVR = false;
    dbg(`[XR init] isMobile=${isMobile}, hasAR=${state.hasAR}`);

    let arActive = false;
    let arPlaced = false;
    let gsplatEntity: Entity | null = null;
    let reticle: Entity | null = null;
    let xr8Loaded = false;
    let slamCanvas: HTMLCanvasElement | null = null;
    let updateCount = 0;

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

    // Find the <video> element 8th Wall creates for camera access
    const findCameraVideo = (): HTMLVideoElement | null => {
        const videos = document.querySelectorAll('video');
        for (const v of videos) {
            if (v.srcObject) return v;
        }
        return null;
    };

    const playcanvasPipelineModule = () => {
        return {
            name: 'playcanvas-sync',
            onStart: () => {
                dbg('[pipeline] onStart fired');
                arActive = true;
                arPlaced = false;
                app.autoRender = true;

                savedClearColor.copy(camera.camera.clearColor);
                savedCameraPos.copy(camera.getPosition());
                savedCameraRot.copy(camera.getRotation());
                savedParentPos.copy(parent.getPosition());
                savedParentRot.copy(parent.getRotation());

                parent.setPosition(0, 0, 0);
                parent.setEulerAngles(0, 0, 0);
                camera.camera.clearColor = new Color(0, 0, 0, 0);

                // PlayCanvas canvas on top
                const pcCanvas = app.graphicsDevice.canvas as HTMLCanvasElement;
                pcCanvas.style.position = 'fixed';
                pcCanvas.style.top = '0';
                pcCanvas.style.left = '0';
                pcCanvas.style.zIndex = '3';

                gsplatEntity = app.root.findByName('gsplat') as Entity | null;
                if (gsplatEntity) gsplatEntity.enabled = false;

                if (!reticle) reticle = buildReticle();
                reticle.enabled = false;

                // Find and style the camera video (8th Wall creates it)
                setTimeout(() => {
                    const video = findCameraVideo();
                    if (video) {
                        video.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:1;';
                        dbg(`[pipeline] video found: ${video.videoWidth}x${video.videoHeight}`);
                    } else {
                        dbg('[pipeline] WARN: no camera video found');
                    }
                }, 500);
            },
            onUpdate: ({ processCpuResult }: any) => {
                updateCount++;
                if (updateCount <= 3 || updateCount % 60 === 0) {
                    const keys = processCpuResult ? Object.keys(processCpuResult) : ['null'];
                    dbg(`[pipeline] onUpdate #${updateCount} keys=[${keys}]`);
                }

                const reality = processCpuResult?.reality;
                if (!reality) return;

                const { rotation, position, intrinsics } = reality;

                if (updateCount <= 3) {
                    dbg(`[pipeline] reality: pos=${JSON.stringify(position)} rot=${!!rotation} intr=${!!intrinsics}`);
                }

                if (rotation && position) {
                    camera.setPosition(position.x, position.y, position.z);
                    camera.setRotation(rotation.x, rotation.y, rotation.z, rotation.w);
                }

                if (intrinsics) {
                    const proj = new Mat4();
                    proj.data.set(intrinsics);
                    // @ts-ignore
                    camera.camera.projectionMatrix = proj;
                    camera.camera.horizontalFov = false;
                }

                if (reticle && !arPlaced) {
                    reticle.enabled = true;
                    const cam = camera.getPosition();
                    const fwd = camera.forward;
                    reticle.setPosition(
                        cam.x + fwd.x * 1.5,
                        0,
                        cam.z + fwd.z * 1.5
                    );
                }

                app.renderNextFrame = true;
            },
            onException: (error: any) => {
                dbg(`[pipeline] EXCEPTION: ${error}`);
            },
            onDetach: () => {
                dbg('[pipeline] onDetach');
                arActive = false;
                arPlaced = false;
                app.autoRender = false;

                if (gsplatEntity) {
                    gsplatEntity.enabled = true;
                    gsplatEntity.setLocalScale(1, 1, 1);
                    gsplatEntity.setPosition(0, 0, 0);
                    gsplatEntity.setLocalEulerAngles(0, 0, 180);
                }

                camera.camera.clearColor = savedClearColor;
                camera.setPosition(savedCameraPos);
                camera.setRotation(savedCameraRot);
                parent.setPosition(savedParentPos);
                parent.setRotation(savedParentRot);

                if (reticle) reticle.enabled = false;

                // Hide slam canvas
                if (slamCanvas) slamCanvas.style.display = 'none';

                // Reset video
                const video = findCameraVideo();
                if (video) video.style.cssText = '';

                const pcCanvas = app.graphicsDevice.canvas as HTMLCanvasElement;
                pcCanvas.style.position = '';
                pcCanvas.style.zIndex = '';

                requestAnimationFrame(() => { app.renderNextFrame = true; });
            }
        };
    };

    // Touch handler — tap turns reticle red (surface detection test)
    const onTouch = (e: TouchEvent) => {
        if (!arActive) return;
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;

        dbg(`[touch] tap detected, reticle=${reticle?.enabled}`);

        if (!reticle || !reticle.enabled) return;

        const mat = reticle.render!.meshInstances[0].material as StandardMaterial;
        mat.diffuse = new Color(1, 0, 0);
        mat.emissive = new Color(1, 0, 0);
        mat.update();

        const rp = reticle.getPosition();
        dbg(`[touch] RETICLE RED at ${rp.x.toFixed(2)},${rp.y.toFixed(2)},${rp.z.toFixed(2)}`);
    };
    document.addEventListener('touchstart', onTouch);

    const loadAndStartAR = async () => {
        dbg('[8thWall] loading scripts...');
        arBtn.textContent = 'Loading...';
        arBtn.style.pointerEvents = 'none';

        try {
            if (!xr8Loaded) {
                await loadScript('./8thwall/xrextras.js');
                dbg('[8thWall] xrextras loaded');
                await loadScript('./8thwall/xr.js', { 'data-preload-chunks': 'slam' });
                dbg('[8thWall] xr.js loaded');
                await waitForXR8();
                dbg('[8thWall] XR8 global ready');

                window.XR8.XrController.configure({
                    disableWorldTracking: false,
                    scale: 'absolute'
                });

                xr8Loaded = true;
            }

            // Separate canvas for 8th Wall SLAM — keeps PlayCanvas WebGL context alive
            if (!slamCanvas) {
                slamCanvas = document.createElement('canvas');
                slamCanvas.id = 'xr8-slam-canvas';
                slamCanvas.width = 320;
                slamCanvas.height = 240;
                slamCanvas.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;z-index:0;pointer-events:none;';
                document.body.appendChild(slamCanvas);
            }
            slamCanvas.style.display = 'block';

            updateCount = 0;
            dbg('[8thWall] adding pipeline modules...');

            window.XR8.addCameraPipelineModules([
                window.XR8.XrController.pipelineModule(),
                playcanvasPipelineModule(),
            ]);

            dbg('[8thWall] calling XR8.run()...');

            window.XR8.run({
                canvas: slamCanvas,
                allowedDevices: window.XR8.XrConfig.device().ANY,
                cameraConfig: { direction: window.XR8.XrConfig.camera().BACK }
            });

            dbg('[8thWall] XR8.run() called');
            exitBtn.style.display = 'block';
            arBtn.style.display = 'none';
        } catch (err: any) {
            dbg(`[8thWall] ERROR: ${err.message}\n${err.stack?.slice(0, 200)}`);
            arBtn.textContent = 'START AR';
            arBtn.style.pointerEvents = 'auto';
        }
    };

    const stopAR = () => {
        dbg('[8thWall] stopping...');
        try { window.XR8.stop(); } catch (e: any) { dbg(`[8thWall] stop: ${e.message}`); }
        exitBtn.style.display = 'none';
        arBtn.style.display = 'block';
        arBtn.textContent = 'START AR';
        arBtn.style.pointerEvents = 'auto';
    };

    const exitBtn = document.createElement('button');
    exitBtn.textContent = 'EXIT AR';
    exitBtn.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);padding:16px 32px;font-size:20px;font-weight:bold;background:#ff4444;color:#fff;border:none;border-radius:12px;cursor:pointer;z-index:99999;display:none;';
    exitBtn.addEventListener('click', stopAR);
    document.body.appendChild(exitBtn);

    const arBtn = document.createElement('button');
    arBtn.textContent = 'START AR';
    arBtn.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;padding:20px 40px;font-size:24px;font-weight:bold;background:#7B72FF;color:#fff;border:none;border-radius:12px;cursor:pointer;';
    arBtn.addEventListener('click', loadAndStartAR);
    document.body.appendChild(arBtn);

    events.on('startAR', loadAndStartAR);
    events.on('inputEvent', (event) => {
        if (event === 'cancel' && arActive) stopAR();
    });
};

export { initXr };
