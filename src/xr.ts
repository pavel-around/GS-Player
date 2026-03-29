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
    if (debugLines.length > 20) debugLines.shift();
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
    let cameraVideo: HTMLVideoElement | null = null;

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

    // Custom pipeline module — manually syncs 8th Wall pose to PlayCanvas camera
    const playcanvasPipelineModule = () => {
        return {
            name: 'playcanvas-sync',
            onStart: ({ GLctx }: any) => {
                dbg('[8thWall] pipeline onStart');
                arActive = true;
                arPlaced = false;
                app.autoRender = true;

                savedClearColor.copy(camera.camera.clearColor);
                savedCameraPos.copy(camera.getPosition());
                savedCameraRot.copy(camera.getRotation());
                savedParentPos.copy(parent.getPosition());
                savedParentRot.copy(parent.getRotation());

                // Reset parent transform for clean AR tracking
                parent.setPosition(0, 0, 0);
                parent.setEulerAngles(0, 0, 0);

                // Transparent background — camera feed shows through
                camera.camera.clearColor = new Color(0, 0, 0, 0);

                // Show camera feed as <video> background — avoids dual WebGL context issue on iOS
                const video = document.querySelector('video');
                if (video) {
                    cameraVideo = video;
                    cameraVideo.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:1;';
                    dbg(`[8thWall] found <video> ${video.videoWidth}x${video.videoHeight}`);
                } else {
                    dbg('[8thWall] WARN: no <video> element found');
                }

                // PlayCanvas canvas on top of video
                const pcCanvas = app.graphicsDevice.canvas as HTMLCanvasElement;
                pcCanvas.style.position = 'fixed';
                pcCanvas.style.top = '0';
                pcCanvas.style.left = '0';
                pcCanvas.style.zIndex = '2';

                gsplatEntity = app.root.findByName('gsplat') as Entity | null;
                if (gsplatEntity) gsplatEntity.enabled = false;

                if (!reticle) reticle = buildReticle();
                reticle.enabled = false;
            },
            onUpdate: ({ processCpuResult }: any) => {
                const reality = processCpuResult?.reality;
                if (!reality) return;

                const { rotation, position, intrinsics } = reality;

                // Apply 8th Wall camera pose to PlayCanvas camera
                if (rotation && position) {
                    camera.setPosition(position.x, position.y, position.z);
                    camera.setRotation(rotation.x, rotation.y, rotation.z, rotation.w);
                }

                // Apply projection matrix
                if (intrinsics) {
                    const proj = new Mat4();
                    proj.data.set(intrinsics);
                    // @ts-ignore — direct projection matrix override
                    camera.camera.projectionMatrix = proj;
                    camera.camera.horizontalFov = false;
                }

                // Reticle on ground in front of camera
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

                // Trigger PlayCanvas render
                app.renderNextFrame = true;
            },
            onDetach: () => {
                dbg('[8thWall] pipeline onDetach');
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

                // Hide camera video
                if (cameraVideo) {
                    cameraVideo.style.cssText = '';
                    cameraVideo = null;
                }

                const pcCanvas = app.graphicsDevice.canvas as HTMLCanvasElement;
                pcCanvas.style.position = '';
                pcCanvas.style.zIndex = '';

                requestAnimationFrame(() => {
                    app.renderNextFrame = true;
                });
            }
        };
    };

    // Touch handler — tap turns reticle red (surface detection test)
    const onTouch = (e: TouchEvent) => {
        if (!arActive) return;
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        if (!reticle || !reticle.enabled) return;

        const mat = reticle.render!.meshInstances[0].material as StandardMaterial;
        mat.diffuse = new Color(1, 0, 0);
        mat.emissive = new Color(1, 0, 0);
        mat.update();

        const rp = reticle.getPosition();
        dbg(`[8thWall] TAP at ${rp.x.toFixed(2)},${rp.y.toFixed(2)},${rp.z.toFixed(2)}`);
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
                dbg('[8thWall] xr.js added');
                await waitForXR8();
                dbg('[8thWall] XR8 ready');

                window.XR8.XrController.configure({
                    disableWorldTracking: false,
                    scale: 'absolute'
                });

                xr8Loaded = true;
            }

            const pcCanvas = app.graphicsDevice.canvas as HTMLCanvasElement;
            dbg(`[8thWall] starting XR8.run() on PlayCanvas canvas`);

            // Add pipeline modules BEFORE run() — otherwise onStart is missed
            // No GlTextureRenderer — camera feed shown via native <video> element
            // This avoids dual WebGL context issue that freezes camera on iOS
            window.XR8.addCameraPipelineModules([
                window.XR8.XrController.pipelineModule(),
                playcanvasPipelineModule(),
            ]);

            window.XR8.run({
                canvas: pcCanvas,
                allowedDevices: window.XR8.XrConfig.device().ANY,
                cameraConfig: { direction: window.XR8.XrConfig.camera().BACK }
            });

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
