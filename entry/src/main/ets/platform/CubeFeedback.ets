import { common } from '@kit.AbilityKit';
import { media } from '@kit.MediaKit';
import { vibrator } from '@kit.SensorServiceKit';

export class CubeFeedback {
  private player: media.AVPlayer | undefined = undefined;
  private context: common.UIAbilityContext | undefined = undefined;
  private disposed: boolean = false;
  private audioDisabled: boolean = false;
  private rawFdOpen: boolean = false;
  private prepareRequested: boolean = false;
  private playPending: boolean = false;
  private prepareTimer: number | undefined = undefined;
  private readyTask: Promise<void> | undefined = undefined;
  private readyCallback: (() => void) | undefined = undefined;
  private cleanupTask: Promise<void> = Promise.resolve();

  public async prepare(context: common.UIAbilityContext): Promise<void> {
    if (this.disposed || this.audioDisabled) {
      return;
    }
    const existing = this.readyTask;
    if (existing !== undefined) {
      return existing;
    }
    const ready = new Promise<void>((resolve: () => void): void => {
      this.readyCallback = resolve;
    });
    this.readyTask = ready;
    try {
      this.prepareTimer = setTimeout((): void => {
        this.disableAudio();
      }, 3000);
      this.setup(context).catch((): void => {
        this.disableAudio();
      });
    } catch {
      this.disableAudio();
    }
    return ready;
  }

  public play(sound: boolean, haptics: boolean): void {
    if (this.disposed) {
      return;
    }
    // Audio failure must never disable independent haptic feedback.
    if (haptics) {
      try {
        vibrator.startVibration({ type: 'time', duration: 12 }, { usage: 'touch' })
          .catch((): void => {});
      } catch {}
    }
    if (!sound || this.audioDisabled || this.playPending) {
      return;
    }
    const player = this.player;
    if (player === undefined) {
      return;
    }
    try {
      if (player.state !== 'prepared' && player.state !== 'completed') {
        return;
      }
      // Cover the gap before the playing event; do not queue or seek turns.
      this.playPending = true;
      player.play().catch((): void => {
        this.disableAudio();
      });
    } catch {
      this.disableAudio();
    }
  }

  public release(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disableAudio();
  }

  private async setup(context: common.UIAbilityContext): Promise<void> {
    try {
      const player = await media.createAVPlayer();
      this.player = player;
      if (this.disposed || this.audioDisabled) {
        this.disableAudio();
        return;
      }
      const descriptor = await context.resourceManager.getRawFd('turn.wav');
      this.context = context;
      this.rawFdOpen = true;
      if (this.disposed || this.audioDisabled) {
        this.disableAudio();
        return;
      }
      player.on('error', (): void => {
        if (!this.audioDisabled) {
          this.disableAudio();
        }
      });
      player.on('stateChange', (state: media.AVPlayerState): void => {
        if (this.disposed || this.audioDisabled) {
          return;
        }
        if (state === 'initialized' && !this.prepareRequested) {
          this.prepareRequested = true;
          try {
            player.prepare().catch((): void => {
              this.disableAudio();
            });
          } catch {
            this.disableAudio();
          }
        } else if (state === 'prepared') {
          try {
            player.setVolume(0.25);
          } catch {
            // Older SDKs can still play the deliberately quiet source WAV.
          }
          this.playPending = false;
          this.finishPreparation();
        } else if (state === 'completed') {
          this.playPending = false;
        } else if (state === 'error' || state === 'released') {
          this.disableAudio();
        }
      });
      player.fdSrc = {
        fd: descriptor.fd,
        offset: descriptor.offset,
        length: descriptor.length
      };
    } catch {
      this.disableAudio();
    }
  }

  private finishPreparation(): void {
    if (this.prepareTimer !== undefined) {
      try {
        clearTimeout(this.prepareTimer);
      } catch {}
      this.prepareTimer = undefined;
    }
    const callback = this.readyCallback;
    this.readyCallback = undefined;
    if (callback !== undefined) {
      callback();
    }
  }

  private disableAudio(): void {
    this.audioDisabled = true;
    this.playPending = false;
    this.finishPreparation();
    const player = this.player;
    const context = this.context;
    const closeFd = this.rawFdOpen;
    this.player = undefined;
    this.context = undefined;
    this.rawFdOpen = false;
    if (player === undefined && !closeFd) {
      return;
    }
    // Late acquisitions re-enter cleanup. Serial cleanup closes fd only after player release.
    this.cleanupTask = this.cleanupTask.then(async (): Promise<void> => {
      if (player !== undefined) {
        try {
          player.off('stateChange');
        } catch {}
        try {
          player.off('error');
        } catch {}
        try {
          await player.release();
        } catch {}
      }
      if (closeFd && context !== undefined) {
        try {
          await context.resourceManager.closeRawFd('turn.wav');
        } catch {}
      }
    }).catch((): void => {});
  }
}

export default CubeFeedback;
