import * as pc from 'playcanvas';
import {
    Color,
    Entity,
    StandardMaterial,
} from 'playcanvas';

import { Global } from './types';

// 8th Wall's built-in PlayCanvas module references `pc` as a global (pc.Color, pc.Entity, etc.)
(window as any).pc = pc;

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

    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1);
    state.hasAR = isMobile;
    state.hasVR = false;
    dbg(`[XR] isMobile=${isMobile}`);

    let arActive = false;
    let arPlaced = false;
    let gsplatEntity: Entity | null = null;
    let reticle: Entity | null = null;
    let xr8Loaded = false;

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

    // Custom pipeline module — runs inside 8th Wall's pipeline alongside the official PlayCanvas module.
    // Camera sync (position, rotation, FOV) is handled by the built-in XR8.PlayCanvas module.
    // This module only handles reticle placement via ground-plane raycast.
    const reticlePipelineModule = () => {
        let updateCount = 0;
        return {
            name: 'reticle-placement',
            onStart: () => {
                dbg('[reticle] onStart');
                arActive = true;
                arPlaced = false;

                gsplatEntity = app.root.findByName('gsplat') as Entity | null;
                if (gsplatEntity) gsplatEntity.enabled = false;

                if (!reticle) reticle = buildReticle();
                reticle.enabled = false;
            },
            onUpdate: () => {
                updateCount++;

                if (updateCount <= 5 || updateCount % 120 === 0) {
                    const p = camera.getPosition();
                    const f = camera.forward;
                    dbg(`[pose] pos=${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)} fwd=${f.x.toFixed(2)},${f.y.toFixed(2)},${f.z.toFixed(2)}`);
                }

                // Ground plane reticle: camera ray → y=0
                if (reticle && !arPlaced) {
                    const cam = camera.getPosition();
                    const fwd = camera.forward;
                    if (fwd.y < -0.1 && cam.y > 0.1) {
                        const t = -cam.y / fwd.y;
                        reticle.setPosition(cam.x + fwd.x * t, 0, cam.z + fwd.z * t);
                        reticle.setLocalEulerAngles(0, 0, 0);
                        reticle.enabled = true;
                    } else {
                        reticle.enabled = false;
                    }
                }

                app.renderNextFrame = true;
            },
            onDetach: () => {
                dbg('[reticle] onDetach');
                arActive = false;
                arPlaced = false;

                if (gsplatEntity) {
                    gsplatEntity.enabled = true;
                    gsplatEntity.setLocalScale(1, 1, 1);
                    gsplatEntity.setPosition(0, 0, 0);
                    gsplatEntity.setLocalEulerAngles(0, 0, 180);
                }
                if (reticle) reticle.enabled = false;
            }
        };
    };

    // Touch handler — fix reticle in place
    const onTouch = (e: TouchEvent) => {
        if (!arActive) return;
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        if (!reticle?.enabled && !arPlaced) return;

        if (!arPlaced) {
            // First tap: lock reticle at current position
            arPlaced = true;
            const mat = reticle!.render!.meshInstances[0].material as StandardMaterial;
            mat.diffuse = new Color(0, 1, 0);
            mat.emissive = new Color(0, 1, 0);
            mat.update();
            const p = reticle!.getPosition();
            dbg(`[touch] fixed at ${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
        } else {
            // Second tap: unlock, resume tracking
            arPlaced = false;
            const mat = reticle!.render!.meshInstances[0].material as StandardMaterial;
            mat.diffuse = new Color(1, 1, 1);
            mat.emissive = new Color(0.5, 0.5, 0.5);
            mat.update();
            dbg('[touch] unlocked');
        }
    };
    document.addEventListener('touchstart', onTouch);

    const loadAndStartAR = async () => {
        dbg('[8W] loading...');
        arBtn.textContent = 'Loading...';
        arBtn.style.pointerEvents = 'none';

        try {
            if (!xr8Loaded) {
                await loadScript('./8thwall/xrextras.js');
                await loadScript('./8thwall/xr.js', { 'data-preload-chunks': 'slam' });
                await waitForXR8();
                dbg('[8W] XR8 ready');

                window.XR8.XrController.configure({
                    disableWorldTracking: false,
                    scale: 'absolute'
                });
                xr8Loaded = true;
            }

            // Use official XR8.PlayCanvas.runXr() integration.
            // This handles: two-canvas setup (#camerafeed behind #application-canvas),
            // GlTextureRenderer (camera feed), XrController (SLAM),
            // camera sync (position/rotation/FOV), ownRunLoop:false (PlayCanvas drives loop).
            // We only pass our reticle module as extra.
            window.XR8.PlayCanvas.runXr(
                { pcCamera: camera, pcApp: app },
                [reticlePipelineModule()]
            );

            dbg('[8W] PlayCanvas.runXr() called');
            exitBtn.style.display = 'block';
            arBtn.style.display = 'none';
        } catch (err: any) {
            dbg(`[8W] ERROR: ${err.message}\n${err.stack?.slice(0, 300)}`);
            arBtn.textContent = 'START AR';
            arBtn.style.pointerEvents = 'auto';
        }
    };

    const stopAR = () => {
        dbg('[8W] stopping...');
        try {
            window.XR8.stop();
        } catch (e: any) {
            dbg(`[8W] stop: ${e.message}`);
        }
        exitBtn.style.display = 'none';
        arBtn.style.display = 'block';
        arBtn.textContent = 'START AR';
        arBtn.style.pointerEvents = 'auto';
    };

    // UI
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
