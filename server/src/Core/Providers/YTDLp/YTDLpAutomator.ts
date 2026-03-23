import { BaseAutomator } from "../Base/BaseAutomator";
import { YTDLpChannel } from "./YTDLpChannel";
import { YTDLpVOD } from "./YTDLpVOD";
import { Helper } from "../../Helper";
import { Config } from "../../Config";
import { DataRoot } from "../../BaseConfig";
import { log, LOGLEVEL } from "../../Log";
import { startJob } from "@/Helpers/Execute";
import type { Providers } from "@common/Defs";
import path from "node:path";
import fs from "node:fs";
import { Webhook } from "../../Webhook";
import type { EndCaptureData, VodUpdated } from "@common/Webhook";

export class YTDLpAutomator extends BaseAutomator {
    public channel: YTDLpChannel | undefined;
    public vod: YTDLpVOD | undefined;
    public realm: Providers = "ytdlp";

    public providerArgs(): string[] {
        return [];
    }

    public async download(): Promise<boolean> {
        if (!this.channel || !this.channel.config?.url) return false;
        if (!this.vod) return false;

        const ytdlp = Helper.path_youtubedl();
        if (!ytdlp) {
            log(LOGLEVEL.ERROR, "ytdlp.download", "yt-dlp not found");
            return false;
        }

        const url = this.channel.config.url;
        const filename = this.vod.filename.replace(".json", ".mp4");
        const vodId = this.vod.capture_id || Date.now().toString();

        log(LOGLEVEL.INFO, "ytdlp.download", `Starting yt-dlp capture for ${this.channel.internalName} to ${filename}`);

        this.vod.started_at = new Date();
        this.vod.is_capturing = true;



        await this.vod.saveJSON("download start");

        const cookiesPath = Config.getInstance().cfg<string>("ytdlp.cookies_path");
        const poToken = Config.getInstance().cfg<string>("ytdlp.po_token");

        let extractorArgs = "youtube:player-client=default,mweb";
        if (poToken) {
            extractorArgs += `;po_token=${poToken}`;
        }

        const args = [];
        if (cookiesPath) {
            args.push("--cookies", cookiesPath);
        }
        args.push("--extractor-args", extractorArgs);
        args.push("--remote-components", "ejs:github");
        args.push("--downloader", "ffmpeg");
        args.push("--no-part");
        args.push("--no-mtime");
        args.push("-o", filename);
        args.push(url);

        const jobName = `capture_${this.channel.internalName}_${vodId}`;
        const env = { ...process.env };
        delete env.NODE_OPTIONS;
        delete env.NODE_PATH;

        this.captureJob = startJob(jobName, ytdlp, args, {
            ...env,
            PATH: `${process.env.PATH}:/root/.deno/bin:/root/.local/bin`
        } as Record<string, string>, DataRoot) || undefined;

        if (!this.captureJob) {
            log(LOGLEVEL.ERROR, "ytdlp.download", `Failed to spawn capture process for ${jobName}`);
            this.vod.is_capturing = false;
            await this.vod.saveJSON("download failed");
            return false;
        }

        log(LOGLEVEL.SUCCESS, "ytdlp.download", `Spawned process ${this.captureJob.pid} for ${jobName}`);
        this.captureJob.addMetadata({
            login: this.channel.internalName,
            capture_filename: filename,
            vod_id: vodId,
        });

        this.channel.broadcastUpdate();

        // send internal webhook for capture start
        void this.vod.toAPI().then((vod) => {
            Webhook.dispatchAll("start_capture", {
                vod: vod,
            } as VodUpdated);
        });


        this.captureJob.on("stdout", (data: string) => {
            // log(LOGLEVEL.DEBUG, "ytdlp.process", data);
        });

        this.captureJob.on("stderr", (data: string) => {
            // log(LOGLEVEL.DEBUG, "ytdlp.process.err", data);
        });

        this.captureJob.on("process_close", async (code: number | null, signal: NodeJS.Signals | null) => {
            log(LOGLEVEL.INFO, "ytdlp.download", `yt-dlp capture finished with code ${code}, signal ${signal}`);

            if (this.captureJob) {
                this.captureJob.clear();
            }

            if (this.vod) {
                this.vod.is_capturing = false;
                this.vod.ended_at = new Date();
                try {
                    await this.vod.finalize();
                } catch (error) {
                    log(LOGLEVEL.ERROR, "ytdlp.download", `Error finalizing VOD: ${(error as Error).message}`);
                }
                await this.vod.saveJSON("download end");
            }

            if (this.channel) {
                this.channel.broadcastUpdate();
            }

            // send internal webhook for capture end
            if (this.vod) {
                const captureSuccess =
                    fs.existsSync(filename) &&
                    fs.statSync(filename).size > 0;

                Webhook.dispatchAll("end_capture", {
                    vod: await this.vod.toAPI(),
                    success: captureSuccess,
                } as EndCaptureData);
            }
        });

        this.captureJob.on("process_error", (err: Error) => {
            log(LOGLEVEL.ERROR, "ytdlp.download", `Error with yt-dlp: ${err.message}`);
        });

        return true;
    }
}
