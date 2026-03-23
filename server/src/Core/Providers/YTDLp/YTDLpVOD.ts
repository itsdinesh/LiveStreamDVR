import { BaseVOD } from "../Base/BaseVOD";
import { Config } from "../../Config";
import { LOGLEVEL, log } from "../../Log";
import type { Providers } from "@common/Defs";
import path from "node:path";
import fs from "node:fs";
import { remuxFile } from "@/Helpers/Video";
import type { VODJSON } from "../../../Storage/JSON";
import { LiveStreamDVR } from "../../LiveStreamDVR";
import { YTDLpChannel } from "./YTDLpChannel";

interface YTDLpVODJSON extends VODJSON {
    type: "ytdlp";
}

export class YTDLpVOD extends BaseVOD {
    public provider: Providers = "ytdlp";
    json?: YTDLpVODJSON;

    public getChannel(): YTDLpChannel | undefined {
        if (!this.channel_uuid) return undefined;
        const channel =
            LiveStreamDVR.getInstance().getChannelByUUID<YTDLpChannel>(
                this.channel_uuid
            );
        return channel || undefined;
    }

    public async toJSON(): Promise<YTDLpVODJSON> {
        const generated = (await super.toJSON()) as YTDLpVODJSON;
        generated.version = 1;
        generated.type = "ytdlp";
        generated.segments = this.segments_raw;
        return generated;
    }

    public async setupUserData(): Promise<void> {
        if (!this.json) throw new Error("No JSON loaded for user data!");
        if (this.json.channel_uuid) {
            this.channel_uuid = this.json.channel_uuid;
        } else {
            log(LOGLEVEL.WARNING, "vod.setupUserData", `No channel UUID for yt-dlp VOD ${this.basename}`);
        }
    }

    public async saveJSON(reason = ""): Promise<boolean> {
        if (!this.filename) {
            throw new Error("Filename not set.");
        }

        await super.saveJSON(reason);

        const generated = await this.toJSON();

        log(
            LOGLEVEL.SUCCESS,
            "vod.saveJSON",
            `Saving JSON of ${this.basename} ${
                reason ? " (" + reason + ")" : ""
            }`
        );

        await this.stopWatching();

        this._writeJSON = true;

        try {
            fs.writeFileSync(this.filename, JSON.stringify(generated, null, 4));
        } catch (error) {
            log(
                LOGLEVEL.FATAL,
                "vod.saveJSON",
                `Failed to save JSON of ${this.basename}: ${
                    (error as Error).message
                }`
            );
            return false;
        }

        this._writeJSON = false;

        await this.startWatching();

        this.broadcastUpdate();

        return true;
    }

    public async finalize(): Promise<boolean> {
        log(
            LOGLEVEL.INFO,
            "vod.finalize",
            `Finalize ${this.basename} @ ${this.directory}`
        );

        // Add the MP4 file as a segment so it appears in the UI
        const mp4Path = this.filename.replace(".json", ".mp4");
        if (fs.existsSync(mp4Path)) {
            // Remux the MP4 file to make it seekable in browser (faststart)
            const tempPath = mp4Path.replace(".mp4", "_remux.mp4");
            try {
                log(
                    LOGLEVEL.INFO,
                    "vod.finalize",
                    `Remuxing ${mp4Path} for browser playback...`
                );
                await remuxFile(mp4Path, tempPath, true);

                // Replace original with remuxed file
                if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
                    fs.unlinkSync(mp4Path);
                    fs.renameSync(tempPath, mp4Path);
                    log(
                        LOGLEVEL.SUCCESS,
                        "vod.finalize",
                        `Successfully remuxed ${this.basename} for browser playback`
                    );
                }
            } catch (error) {
                log(
                    LOGLEVEL.ERROR,
                    "vod.finalize",
                    `Failed to remux ${this.basename}: ${(error as Error).message}`
                );
                // Clean up temp file if it exists
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            }

            const mp4Basename = path.basename(mp4Path);
            if (!this.segments_raw.includes(mp4Basename)) {
                log(
                    LOGLEVEL.INFO,
                    "vod.finalize",
                    `Adding segment ${mp4Basename} to ${this.basename}`
                );
                await this.addSegment(mp4Basename);
            }
        } else {
            log(
                LOGLEVEL.WARNING,
                "vod.finalize",
                `MP4 file not found for ${this.basename}: ${mp4Path}`
            );
        }

        try {
            await this.getMediainfo();
        } catch (error) {
            log(
                LOGLEVEL.ERROR,
                "vod.finalize",
                `Failed to get mediainfo for ${this.basename}: ${error}`
            );
        }

        this.is_finalized = true;

        // Broadcast update so UI reflects the new segment
        this.broadcastUpdate();

        return true;
    }

    public static async load(filename: string): Promise<YTDLpVOD> {
        const basename = path.basename(filename);

        // check if file exists
        if (!fs.existsSync(filename)) {
            throw new Error("VOD JSON does not exist: " + filename);
        }

        // load file
        const data = fs.readFileSync(filename, "utf8");
        if (data.length == 0) {
            throw new Error("File is empty: " + filename);
        }

        // parse file
        const json: VODJSON = JSON.parse(data);

        // create object
        const vod = new YTDLpVOD();

        vod.uuid = json.uuid || "";
        vod.capture_id = json.capture_id || "";
        vod.filename = filename;
        vod.basename = path.basename(filename, ".json");
        vod.directory = path.dirname(filename);

        vod.json = json as any;

        vod.setupDates();
        await vod.setupUserData();
        vod.setupBasic();
        await vod.setupAssoc();
        await vod.setupFiles();

        await vod.startWatching();

        if (!vod.not_started && !vod.is_finalized) {
            log(
                LOGLEVEL.WARNING,
                "vod.load",
                `Loaded VOD ${vod.basename} is not finalized!`
            );
        }

        vod.loaded = true;
        this.addVod(vod);
        return vod;
    }
}
