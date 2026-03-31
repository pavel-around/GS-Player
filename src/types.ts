import type { Entity, EventHandler, AppBase } from 'playcanvas';

import type { ExperienceSettings } from './settings';

type CameraMode = 'orbit' | 'anim' | 'fly' | 'walk';

type InputMode = 'desktop' | 'touch';

// configuration options are immutable at runtime
type Config = {
    poster?: HTMLImageElement;
    skyboxUrl?: string;
    contentUrl?: string;
    contents?: Promise<Response>;
    voxelUrl?: string;

    noui: boolean;
    noanim: boolean;
    nofx: boolean;                              // disable post effects
    hpr?: boolean;                              // override highPrecisionRendering (undefined = use settings)
    ministats: boolean;
    colorize: boolean;                          // render with LOD colorization
    unified: boolean;                           // force unified rendering mode
    fullload: boolean;                          // load all streaming LOD data before first frame
    aa: boolean;                                // render with antialiasing
    webgpu: boolean;                            // use WebGPU device
    gpusort: boolean;                           // use GPU sorting for splats
    heatmap: boolean;                           // render heatmap debug overlay (WebGPU only)

    // 4DGS sequence
    sequenceBaseUrl?: string;                   // base URL for PLY frame sequence
    sequenceFrameCount: number;                 // number of frames (default 121)
    sequenceFps: number;                        // playback framerate (default 24)
};

// observable state that can change at runtime
type State = {
    loaded: boolean;                            // true once first frame is rendered
    readyToRender: boolean;                     // don't render till this is set
    retinaDisplay: boolean;
    progress: number;                           // content loading progress 0-100
    inputMode: InputMode;
    cameraMode: CameraMode;
    hasAnimation: boolean;
    animationDuration: number;
    animationTime: number;
    animationPaused: boolean;
    hasAR: boolean;
    hasVR: boolean;
    arActive: boolean;
    hasCollision: boolean;
    hasVoxelOverlay: boolean;
    voxelOverlayEnabled: boolean;
    isFullscreen: boolean;
    controlsHidden: boolean;
    gamingControls: boolean;

    // 4DGS sequence
    hasSequence: boolean;
    sequenceFrame: number;
    sequenceFrameCount: number;
    sequenceLoaded: boolean;
};

type Global = {
    app: AppBase;
    settings: ExperienceSettings;
    config: Config;
    state: State;
    events: EventHandler;
    camera: Entity;
};

export { CameraMode, InputMode, Config, State, Global };
