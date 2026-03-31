import {
    Asset,
    Entity,
    platform,
    type AppBase,
    type EventHandler
} from 'playcanvas';

import type { Config, State } from './types';

class SequencePlayer {
    private app: AppBase;
    private entity: Entity;
    private assets: (Asset | null)[];
    private config: { baseUrl: string; frameCount: number; fps: number; aa: boolean };
    private state: State;
    private events: EventHandler;

    private currentFrame = 0;
    private timer = 0;
    private loadedCount = 1; // frame 0 already loaded

    static async loadFirstFrame(
        app: AppBase,
        config: Config,
        progressCallback: (progress: number) => void
    ): Promise<Entity> {
        const baseUrl = config.sequenceBaseUrl!;
        const url = `${baseUrl}frame_00000.ply`;
        const filename = 'frame_00000.ply';

        const asset = new Asset(filename, 'gsplat', { url, filename, contents: undefined as any });

        return new Promise<Entity>((resolve, reject) => {
            asset.on('load', () => {
                const entity = new Entity('gsplat');
                entity.setLocalEulerAngles(0, 0, 0);
                entity.addComponent('gsplat', { asset });

                const material = entity.gsplat.material;
                if (material) {
                    material.setDefine('GSPLAT_AA', config.aa);
                    material.setParameter('alphaClip', 1 / 255);
                }

                app.root.addChild(entity);

                // Store the first asset on the entity for retrieval in constructor
                (entity as any)._seqFirstAsset = asset;

                resolve(entity);
            });

            let watermark = 0;
            asset.on('progress', (received: number, length: number) => {
                const progress = Math.min(1, received / length) * 100;
                if (progress > watermark) {
                    watermark = progress;
                    progressCallback(Math.trunc(watermark));
                }
            });

            asset.on('error', (err: string) => {
                console.error('Failed to load first frame:', err);
                reject(new Error(err));
            });

            app.assets.add(asset);
            app.assets.load(asset);
        });
    }

    constructor(app: AppBase, entity: Entity, config: Config, state: State, events: EventHandler) {
        this.app = app;
        this.entity = entity;
        this.state = state;
        this.events = events;
        this.config = {
            baseUrl: config.sequenceBaseUrl!,
            frameCount: config.sequenceFrameCount,
            fps: config.sequenceFps,
            aa: config.aa
        };

        // Initialize assets array
        this.assets = new Array(this.config.frameCount).fill(null);
        this.assets[0] = (entity as any)._seqFirstAsset as Asset;

        // Set up animation state
        state.hasAnimation = true;
        state.animationDuration = this.config.frameCount / this.config.fps;
        state.animationPaused = config.noanim;

        // Playback update
        app.on('update', (dt: number) => {
            if (state.animationPaused) return;

            this.timer += dt;
            const totalDuration = this.config.frameCount / this.config.fps;

            // Loop
            if (this.timer >= totalDuration) {
                this.timer %= totalDuration;
            }

            const targetFrame = Math.floor(this.timer * this.config.fps) % this.config.frameCount;

            if (targetFrame !== this.currentFrame && this.assets[targetFrame]) {
                this.setFrame(targetFrame);
            }

            state.animationTime = this.timer;
            app.renderNextFrame = true;
        });

        // Scrub from timeline
        events.on('scrubAnim', (time: number) => {
            this.scrubTo(time);
        });
    }

    async loadRemaining(): Promise<void> {
        const { app, config, assets, state } = this;
        const concurrency = platform.mobile ? 3 : 6;
        const queue: number[] = [];
        for (let i = 1; i < config.frameCount; i++) queue.push(i);

        const loadOne = async (): Promise<void> => {
            const idx = queue.shift();
            if (idx === undefined) return;

            const paddedIdx = String(idx).padStart(5, '0');
            const url = `${config.baseUrl}frame_${paddedIdx}.ply`;
            const filename = `frame_${paddedIdx}.ply`;

            try {
                const response = await fetch(url);
                const buffer = await response.arrayBuffer();

                const asset = new Asset(filename, 'gsplat', { url, filename, contents: buffer as any });

                await new Promise<void>((resolve) => {
                    asset.on('load', () => {
                        assets[idx] = asset;
                        this.loadedCount++;
                        state.sequenceFrame = this.loadedCount; // reuse for loading progress display
                        resolve();
                    });
                    asset.on('error', (err: string) => {
                        console.warn(`Failed to load frame ${idx}:`, err);
                        resolve(); // skip bad frames
                    });
                    app.assets.add(asset);
                    app.assets.load(asset);
                });
            } catch (err) {
                console.warn(`Failed to fetch frame ${idx}:`, err);
            }
        };

        const runWorker = async () => {
            while (queue.length > 0) {
                await loadOne();
            }
        };

        const workers: Promise<void>[] = [];
        for (let i = 0; i < concurrency; i++) {
            workers.push(runWorker());
        }
        await Promise.all(workers);

        state.sequenceLoaded = true;
        console.log(`[4DGS] All ${this.loadedCount}/${config.frameCount} frames loaded`);
    }

    private setFrame(index: number): void {
        const asset = this.assets[index];
        if (!asset || !asset.resource) return;

        this.currentFrame = index;
        this.entity.gsplat.asset = asset;

        // Re-apply material settings since new instance is created on asset swap
        const material = this.entity.gsplat.material;
        if (material) {
            material.setDefine('GSPLAT_AA', this.config.aa);
            material.setParameter('alphaClip', 1 / 255);
        }

        this.state.sequenceFrame = index;
        this.app.renderNextFrame = true;
    }

    private scrubTo(time: number): void {
        const totalDuration = this.config.frameCount / this.config.fps;
        this.timer = Math.max(0, Math.min(time, totalDuration));
        const targetFrame = Math.floor(this.timer * this.config.fps) % this.config.frameCount;
        if (this.assets[targetFrame]) {
            this.setFrame(targetFrame);
        }
        this.state.animationTime = this.timer;
    }
}

export { SequencePlayer };
