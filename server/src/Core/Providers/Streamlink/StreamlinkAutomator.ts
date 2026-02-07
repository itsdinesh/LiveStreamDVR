import { BaseAutomator } from "../Base/BaseAutomator";
import { StreamlinkChannel } from "./StreamlinkChannel";
import { StreamlinkVOD } from "./StreamlinkVOD";
import { Helper } from "../../Helper";
import { log, LOGLEVEL } from "../../Log";
import { startJob } from "@/Helpers/Execute";
import path from "path";
import fs from "fs";

export class StreamlinkAutomator extends BaseAutomator {
    public channel: StreamlinkChannel | undefined;
    public vod: StreamlinkVOD | undefined;
    public realm = "streamlink";

    public providerArgs(): string[] {
        return [];
    }

    public async download(): Promise<boolean> {
        if (!this.channel || !this.channel.config?.url) return false;
        if (!this.vod) return false;

        const streamlink = Helper.path_streamlink();
        if (!streamlink) {
            log(LOGLEVEL.ERROR, "streamlink.download", "Streamlink not found");
            return false;
        }

        const url = this.channel.config.url;
        const filename = this.vod.filename.replace(".json", ".mp4");
        const vodId = this.vod.capture_id || Date.now().toString();

        log(LOGLEVEL.INFO, "streamlink.download", `Starting Streamlink capture for ${this.channel.internalName} to ${filename}`);

        this.vod.started_at = new Date();
        this.vod.is_capturing = true;
        await this.vod.saveJSON("download start");

        // streamlink "$URL" best -o "$FILE"
        const args = [
            url,
            "best", // TODO: Configurable quality
            "-o", filename
        ];

        // Create job for tracking (enables abort from dashboard)
        const jobName = `capture_${this.channel.internalName}_${vodId}`;
        this.captureJob = startJob(jobName, streamlink, args) || undefined;

        if (!this.captureJob) {
            log(LOGLEVEL.ERROR, "streamlink.download", `Failed to spawn capture process for ${jobName}`);
            this.vod.is_capturing = false;
            await this.vod.saveJSON("download failed");
            return false;
        }

        log(LOGLEVEL.SUCCESS, "streamlink.download", `Spawned process ${this.captureJob.pid} for ${jobName}`);
        this.captureJob.addMetadata({
            login: this.channel.internalName,
            capture_filename: filename,
            vod_id: vodId,
        });

        this.channel.broadcastUpdate();

        this.captureJob.on("stdout", (data: string) => {
            // log(LOGLEVEL.DEBUG, "streamlink.process", data);
        });

        this.captureJob.on("stderr", (data: string) => {
            // log(LOGLEVEL.DEBUG, "streamlink.process.err", data);
        });

        this.captureJob.on("process_close", async (code: number | null, signal: NodeJS.Signals | null) => {
            log(LOGLEVEL.INFO, "streamlink.download", `Streamlink capture finished with code ${code}, signal ${signal}`);

            if (this.captureJob) {
                this.captureJob.clear();
            }

            if (this.vod) {
                this.vod.is_capturing = false;
                this.vod.ended_at = new Date();
                try {
                    await this.vod.finalize();
                    // await this.vod.saveJSON("download end");
                } catch (error) {
                    log(LOGLEVEL.ERROR, "streamlink.download", `Error finalizing VOD: ${(error as Error).message}`);
                }
                await this.vod.saveJSON("download end");
            }

            if (this.channel) {
                this.channel.broadcastUpdate();
            }
        });

        this.captureJob.on("process_error", (err: Error) => {
            log(LOGLEVEL.ERROR, "streamlink.download", `Error with streamlink: ${err.message}`);
        });

        return true;
    }
}
