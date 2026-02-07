import { BaseVOD } from "../Base/BaseVOD";
import type { BaseVODChapter } from "../Base/BaseVODChapter";
import { StreamlinkChannel } from "./StreamlinkChannel";
import type { Providers } from "@common/Defs";
import type { VODJSON } from "@/Storage/JSON";
import type { ApiStreamlinkVod } from "@common/Api/Client";
import { log, LOGLEVEL } from "../../Log";
import { LiveStreamDVR } from "../../LiveStreamDVR";
import { remuxFile } from "@/Helpers/Video";
import path from "path";
import fs from "fs";
import chalk from "chalk";

interface StreamlinkVODJSON extends VODJSON {
    type: "streamlink";
    version: number;
    chapters: ReturnType<BaseVODChapter["toJSON"]>[];
    segments: string[];
}

export class StreamlinkVOD extends BaseVOD {
    public provider: Providers = "streamlink";
    json?: StreamlinkVODJSON;
    chapters: Array<BaseVODChapter> = [];

    public getChannel(): StreamlinkChannel | undefined {
        if (!this.channel_uuid) return undefined;
        const channel =
            LiveStreamDVR.getInstance().getChannelByUUID<StreamlinkChannel>(
                this.channel_uuid
            );
        return channel || undefined;
    }

    public async toAPI(): Promise<ApiStreamlinkVod> {
        if (!this.uuid) throw new Error(`No UUID set on VOD ${this.basename}`);
        if (!this.channel_uuid)
            throw new Error(`No channel UUID set on VOD ${this.basename}`);
        return await Promise.resolve({
            ...(await super.toAPI()),
            provider: "streamlink",
            segments: this.segments.map((s) => s.toAPI()),
            segments_raw: this.segments_raw,
            api_getRecordingSize: this.getRecordingSize(),
            chapters: this.chapters.map((c) => c.toAPI()),
        });
    }

    public async toJSON(): Promise<StreamlinkVODJSON> {
        const generated = (await super.toJSON()) as StreamlinkVODJSON;

        generated.version = 2;
        generated.type = "streamlink";

        generated.chapters = this.chapters.map((chapter) => chapter.toJSON());
        generated.segments = this.segments.map(
            (segment) => segment.filename || ""
        );

        return await Promise.resolve(generated);
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
            `Saving JSON of ${this.basename} ${reason ? " (" + reason + ")" : ""
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
                `Failed to save JSON of ${this.basename}: ${(error as Error).message
                }`
            );
            console.log(
                chalk.bgRedBright.whiteBright(
                    `Failed to save JSON of ${this.basename}: ${(error as Error).message
                    }`
                )
            );
            return false;
        }

        this._writeJSON = false;

        await this.startWatching();

        this.broadcastUpdate();

        return true;
    }

    public async setupUserData(): Promise<void> {
        if (!this.json) {
            throw new Error("No JSON loaded for user data setup!");
        }

        if (this.json.channel_uuid) {
            this.channel_uuid = this.json.channel_uuid;
        } else {
            log(
                LOGLEVEL.ERROR,
                "vod.setupUserData",
                `No channel UUID for VOD ${this.basename}`
            );
        }

        return await Promise.resolve();
    }

    public static async load(filename: string): Promise<StreamlinkVOD> {
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
        const vod = new StreamlinkVOD();

        vod.uuid = json.uuid || "";
        vod.capture_id = json.capture_id || "";
        vod.filename = filename;
        vod.basename = path.basename(filename, ".json");
        vod.directory = path.dirname(filename);

        vod.json = json as StreamlinkVODJSON;

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
}
