import { BaseChannel } from "../Base/BaseChannel";
import { StreamlinkChannelConfig } from "@common/Config";
import { StreamlinkVOD } from "./StreamlinkVOD";
import { StreamlinkAutomator } from "./StreamlinkAutomator";
import { Helper } from "../../Helper";
import { log, LOGLEVEL } from "../../Log";
import type { ApiStreamlinkChannel, ApiStreamlinkVod } from "@common/Api/Client";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { LiveStreamDVR } from "../../LiveStreamDVR";
import { BaseConfigDataFolder } from "../../BaseConfig";
import { Config } from "../../Config";

export class StreamlinkChannel extends BaseChannel {
    public static async create(config: StreamlinkChannelConfig): Promise<StreamlinkChannel> {
        if (!config.uuid) config.uuid = randomUUID();

        if (LiveStreamDVR.getInstance().channels_config.find(c => c.uuid === config.uuid)) {
            throw new Error(`Channel ${config.uuid} already exists`);
        }

        LiveStreamDVR.getInstance().channels_config.push(config);
        LiveStreamDVR.getInstance().saveChannelsConfig();

        const channel = await StreamlinkChannel.load(config.uuid);
        await channel.postLoad();
        LiveStreamDVR.getInstance().addChannel(channel);
        return channel;
    }

    public static async load(uuid: string): Promise<StreamlinkChannel> {
        const config = LiveStreamDVR.getInstance().channels_config.find(c => c.uuid === uuid);
        if (!config) throw new Error(`Channel ${uuid} not found in config`);
        const channel = new StreamlinkChannel();
        channel.uuid = uuid;
        channel.config = config as StreamlinkChannelConfig;
        // return await super.load(uuid) as StreamlinkChannel;
        return channel;
    }

    public async parseVODs(rescan = false): Promise<void> {
        this.vods_raw = this.rescanVods();
        this.vods_list = [];
        for (const vod of this.vods_raw) {
            const vodFullPath = path.join(BaseConfigDataFolder.vod, vod);
            try {
                const vodclass = await StreamlinkVOD.load(vodFullPath);
                this.addVod(vodclass);
            } catch (e) {
                log(
                    LOGLEVEL.ERROR,
                    "streamlink.channel.parseVODs",
                    `Could not load VOD ${vod}: ${(e as Error).message}`
                );
            }
        }
        this.sortVods();
    }

    public async postLoad(): Promise<void> {
        this.makeFolder();
        if (this.config?.schedule_enabled) {
            await this.startWatching();
        }

        const vods = this.rescanVods();
        for (const vod of vods) {
            try {
                const vodObj = await StreamlinkVOD.load(path.join(BaseConfigDataFolder.vod, vod));
                this.addVod(vodObj);
            } catch (e) {
                log(LOGLEVEL.ERROR, "channel.postLoad", `Failed to load VOD ${vod}: ${(e as Error).message}`);
            }
        }
    }

    public config: StreamlinkChannelConfig | undefined;
    public provider = "streamlink";

    public update(config: StreamlinkChannelConfig): boolean {
        const i = LiveStreamDVR.getInstance().channels_config.findIndex(c => c.uuid === this.uuid);
        if (i !== -1) {
            this.config = config;
            this.applyConfig(config);
            LiveStreamDVR.getInstance().channels_config[i] = config;
            LiveStreamDVR.getInstance().saveChannelsConfig();
            return true;
        }
        return false;
    }

    public applyConfig(config: StreamlinkChannelConfig): void {
        super.applyConfig(config);
        if (config.schedule_enabled) {
            // Skip initial check if schedule was already running (just updating settings)
            const wasAlreadyRunning = this.checkTimer !== undefined;
            void this.startWatching(wasAlreadyRunning);
        } else if (this.checkTimer) {
            // Stop watching when schedule is disabled
            void this.stopWatching();
        }
        this.broadcastUpdate();
    }

    private checkTimer: NodeJS.Timeout | undefined;
    private checkStart: number | undefined;

    public get internalName(): string {
        return this.config?.internalName || "";
    }

    public get displayName(): string {
        return this.config?.internalName || "";
    }

    public get internalId(): string {
        return this.uuid;
    }

    public get description(): string {
        return `Streamlink: ${this.config?.url || "No URL"}`;
    }

    public get profilePictureUrl(): string {
        return this.config?.icon_url || "";
    }

    public get url(): string {
        return this.config?.url || "";
    }

    public get is_live(): boolean {
        return this.vods_list.some((vod) => vod.is_capturing);
    }

    public async toAPI(): Promise<ApiStreamlinkChannel> {
        const api = await super.toAPI();
        const scheduleEnabled = this.config?.schedule_enabled ?? false;
        const ret: ApiStreamlinkChannel = {
            ...api,
            provider: "streamlink",
            icon_url: this.config?.icon_url,
            url: this.url,
            vods_list: await Promise.all(this.vods_list.map((v) => v.toAPI())) as unknown as ApiStreamlinkVod[],
            // Hide next_check when schedule is disabled or when capturing
            next_check: (!scheduleEnabled || this.is_capturing) ? undefined : this.next_check?.toISOString(),
            // Hide check_timeout when schedule is disabled
            check_timeout: scheduleEnabled && this.checkStart && this.config?.max_check_duration && this.config.max_check_duration > -1
                ? new Date(this.checkStart + Helper.timeToMilliseconds(this.config.max_check_duration, this.config.max_check_duration_unit || "minutes")).toISOString()
                : undefined,
        };
        return ret;
    }

    private next_check: Date | undefined;

    public async startWatching(skipInitialCheck = false): Promise<boolean> {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = undefined;
        }

        if (!this.config?.schedule_enabled) {
            log(LOGLEVEL.INFO, "streamlink.startWatching", `Scheduling disabled for ${this.internalName}`);
            this.next_check = undefined;
            return false;
        }

        const interval = Helper.timeToMilliseconds(this.config.check_interval || 60, this.config.check_interval_unit || "seconds");
        this.checkStart = Date.now();
        this.next_check = new Date(Date.now() + interval);

        log(LOGLEVEL.INFO, "streamlink.startWatching", `Starting scheduled checks for ${this.internalName} every ${interval / 1000}s`);

        this.checkTimer = setInterval(() => {
            this.next_check = new Date(Date.now() + interval);
            void this.checkStream();
        }, interval);

        // Only check immediately on initial start, not on config updates
        if (!skipInitialCheck) {
            void this.checkStream();
        }

        return true;
    }

    public async stopWatching(): Promise<void> {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = undefined;
            this.next_check = undefined;
            this.checkStart = undefined;
        }
        await super.stopWatching();
    }

    private isCheckingStream = false;

    private async checkStream() {
        if (this.is_capturing) return;
        if (this.isCheckingStream) return;

        this.isCheckingStream = true;

        try {
            // Broadcast update to notify clients of new next_check
            this.broadcastUpdate();

            // Check max duration
            if (this.config?.max_check_duration && this.config.max_check_duration > 0 && this.checkStart) {
                const maxDuration = Helper.timeToMilliseconds(this.config.max_check_duration, this.config.max_check_duration_unit || "minutes");
                if (Date.now() - this.checkStart > maxDuration) {
                    log(LOGLEVEL.INFO, "streamlink.checkStream", `Max check duration exceeded for ${this.internalName}, stopping checks.`);
                    void this.stopWatching();
                    return;
                }
            }

            if (await this.isLiveApi()) {
                log(LOGLEVEL.INFO, "streamlink.checkStream", `Stream ${this.internalName} is live, starting capture.`);
                await this.downloadLatestVod("best");
            }
        } finally {
            this.isCheckingStream = false;
        }
    }

    public async isLiveApi(): Promise<boolean> {
        if (!this.config?.url) return false;

        const streamlink = Helper.path_streamlink();
        if (!streamlink) return false;

        return new Promise((resolve) => {
            const process = spawn(streamlink, [
                "--json",
                this.config!.url!
            ]);

            // If it returns JSON with stream info, it's live.
            // If it errors or returns error box, it's offline.

            let output = "";
            process.stdout.on("data", (data) => output += data);

            process.on("close", (code) => {
                if (code === 0) {
                    try {
                        const json = JSON.parse(output);
                        if (json.streams) return resolve(true); // "streams" object exists usually? 
                        // Actually streamlink --json output depends on presence of stream.
                        // If no stream, it might output error json?
                        if (json.error) return resolve(false);
                        return resolve(true); // Assume success output means live
                    } catch (e) {
                        resolve(false);
                    }
                } else {
                    resolve(false);
                }
            });
        });
    }

    public async downloadLatestVod(quality: string): Promise<string> {
        const now = Date.now();
        // Format timestamp like Twitch: 2026-01-12T16_04_02Z (replace colons with underscores for filesystem compatibility)
        const timestamp = new Date(now).toISOString().replace(/:/g, "_").replace(/\.\d{3}Z$/, "Z");
        const vod = await this.createVOD(path.join(this.getFolder(), `${this.internalName}_${timestamp}_${now}.json`), `${now}`);

        const automator = new StreamlinkAutomator();
        automator.broadcaster_user_login = this.internalName;
        automator.channel = this as any;
        automator.vod = vod;

        void automator.download();

        return vod.uuid;
    }

    // public async createVOD(filename: string, capture_id: string): Promise<StreamlinkVOD> {
    public async createVOD(filename: string, capture_id: string): Promise<StreamlinkVOD> {
        this.makeFolder();
        const vod = new StreamlinkVOD();
        vod.uuid = capture_id;
        vod.capture_id = capture_id; // Set capture ID for UI display
        vod.filename = filename;
        vod.basename = path.basename(filename, ".json");
        vod.directory = path.dirname(filename);
        vod.channel_uuid = this.uuid;
        vod.created_at = new Date();

        // Set webpath for segment URLs (same logic as BaseVOD.setupBasic)
        vod.webpath = `${Config.getInstance().cfg<string>("basepath", "")}/vods/` +
            path.relative(BaseConfigDataFolder.vod, vod.directory);

        this.addVod(vod);

        await vod.saveJSON("create");

        this.saveVodDatabase();
        this.broadcastUpdate();
        return vod;
    }

    public getVods(): StreamlinkVOD[] {
        return this.vods_list as StreamlinkVOD[];
    }
}
