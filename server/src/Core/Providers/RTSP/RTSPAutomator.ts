import { BaseAutomator } from "../Base/BaseAutomator";
import { RTSPChannel } from "./RTSPChannel";
import { RTSPVOD } from "./RTSPVOD";
import { Helper } from "../../Helper";
import { log, LOGLEVEL } from "../../Log";
import { startJob } from "@/Helpers/Execute";
import fs from "fs";
import path from "path";

export class RTSPAutomator extends BaseAutomator {
    public channel: RTSPChannel | undefined;
    public vod: RTSPVOD | undefined;
    public realm = "rtsp";

    public providerArgs(): string[] {
        return []; // Not used for direct ffmpeg spawning in this context, but required by BaseAutomator
    }

    public async download(): Promise<boolean> {
        if (!this.channel || !this.channel.config?.url) return false;
        if (!this.vod) return false;

        const ffmpeg = Helper.path_ffmpeg();
        if (!ffmpeg) {
            log(LOGLEVEL.ERROR, "rtsp.download", "FFmpeg not found");
            return false;
        }

        let url = this.channel.config.url;
        const filename = this.vod.filename.replace(".json", ".mp4");
        const vodId = this.vod.capture_id || Date.now().toString();

        log(LOGLEVEL.INFO, "rtsp.download", `Starting RTSP capture for ${this.channel.internalName} to ${filename}`);

        this.vod.started_at = new Date();
        this.vod.is_capturing = true;
        await this.vod.saveJSON("download start");

        // Construct FFmpeg args for RTSP capture
        const args = [
            "-y",
            "-v", "error",
        ];

        if (url.startsWith("rtsp://") || url.startsWith("rtspt://")) {
            args.push("-rtsp_transport", "tcp");
            url = url.replace(/^rtspt:\/\//, "rtsp://");
        } else if (url.startsWith("rtspu://")) {
            args.push("-rtsp_transport", "udp");
            url = url.replace(/^rtspu:\/\//, "rtsp://");
        }

        args.push("-i", url);
        args.push("-c", "copy");
        args.push(filename);

        // Create job for tracking (enables abort from dashboard)
        const jobName = `capture_${this.channel.internalName}_${vodId}`;
        this.captureJob = startJob(jobName, ffmpeg, args) || undefined;

        if (!this.captureJob) {
            log(LOGLEVEL.ERROR, "rtsp.download", `Failed to spawn capture process for ${jobName}`);
            this.vod.is_capturing = false;
            await this.vod.saveJSON("download failed");
            return false;
        }

        log(LOGLEVEL.SUCCESS, "rtsp.download", `Spawned process ${this.captureJob.pid} for ${jobName}`);
        this.captureJob.addMetadata({
            login: this.channel.internalName,
            capture_filename: filename,
            vod_id: vodId,
        });

        this.channel.broadcastUpdate();

        this.captureJob.on("stdout", (data: string) => {
            // log(LOGLEVEL.DEBUG, "rtsp.ffmpeg", data);
        });

        this.captureJob.on("stderr", (data: string) => {
            // log(LOGLEVEL.DEBUG, "rtsp.ffmpeg.err", data);
        });

        this.captureJob.on("process_close", async (code: number | null, signal: NodeJS.Signals | null) => {
            log(LOGLEVEL.INFO, "rtsp.download", `RTSP capture finished with code ${code}, signal ${signal}`);

            if (this.captureJob) {
                this.captureJob.clear();
            }

            if (this.vod) {
                this.vod.is_capturing = false;
                this.vod.ended_at = new Date();
                try {
                    await this.vod.finalize();
                    await this.vod.saveJSON("download end");
                } catch (error) {
                    log(LOGLEVEL.ERROR, "rtsp.download", `Error finalizing VOD: ${(error as Error).message}`);
                }
            }

            if (this.channel) {
                this.channel.broadcastUpdate();
            }
        });

        this.captureJob.on("process_error", (err: Error) => {
            log(LOGLEVEL.ERROR, "rtsp.download", `Error with ffmpeg: ${err.message}`);
        });

        return true;
    }
}
