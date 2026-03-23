import { log, LOGLEVEL } from "../../Log";
import type { ApiYTDLpChannel, ApiYTDLpVod } from "@common/Api/Client";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { LiveStreamDVR } from "../../LiveStreamDVR";
import { BaseConfigDataFolder, DataRoot } from "../../BaseConfig";
import { Helper } from "../../Helper";
import { Config } from "../../Config";
import type { Providers } from "@common/Defs";
import { BaseChannel } from "../Base/BaseChannel";
import type { BaseVOD } from "../Base/BaseVOD";
import type { ChannelConfig } from "@common/Config";
import { YTDLpChannelConfig } from "@common/Config";
import { YTDLpVOD } from "./YTDLpVOD";
import { YTDLpAutomator } from "./YTDLpAutomator";

export class YTDLpChannel extends BaseChannel {
    public static async create(config: YTDLpChannelConfig): Promise<YTDLpChannel> {
        if (!config.uuid) config.uuid = randomUUID();

        if (LiveStreamDVR.getInstance().channels_config.find(c => c.uuid === config.uuid)) {
            throw new Error(`Channel ${config.uuid} already exists`);
        }

        LiveStreamDVR.getInstance().channels_config.push(config);
        LiveStreamDVR.getInstance().saveChannelsConfig();

        const channel = await YTDLpChannel.load(config.uuid);
        await channel.postLoad();
        LiveStreamDVR.getInstance().addChannel(channel);
        return channel;
    }

    public static async load(uuid: string): Promise<YTDLpChannel> {
        const config = LiveStreamDVR.getInstance().channels_config.find(c => c.uuid === uuid) as YTDLpChannelConfig;
        if (!config) throw new Error(`Channel ${uuid} not found in config`);
        const channel = new YTDLpChannel();
        channel.uuid = uuid;
        channel.config = config as YTDLpChannelConfig;
        return channel;
    }

    public async parseVODs(rescan = false): Promise<void> {
        this.vods_raw = this.rescanVods();
        this.vods_list = [];
        for (const vod of this.vods_raw) {
            const vodFullPath = path.join(BaseConfigDataFolder.vod, vod);
            try {
                const vodclass = await YTDLpVOD.load(vodFullPath);
                this.addVod(vodclass);
            } catch (e) {
                log(
                    LOGLEVEL.ERROR,
                    "ytdlp.channel.parseVODs",
                    `Could not load VOD ${vod}: ${(e as Error).message}`
                );
            }
        }
        this.sortVods();
    }

    public async postLoad(): Promise<void> {
        if (this.config?.schedule_enabled) {
            await this.startWatching();
        }

        const vods = this.rescanVods();
        for (const vod of vods) {
            try {
                const vodObj = await YTDLpVOD.load(path.join(BaseConfigDataFolder.vod, vod));
                this.addVod(vodObj);
            } catch (e) {
                log(LOGLEVEL.ERROR, "channel.postLoad", `Failed to load VOD ${vod}: ${(e as Error).message}`);
            }
        }
    }

    public declare uuid: string;
    public config: YTDLpChannelConfig | undefined;
    public provider: Providers = "ytdlp";

    public update(config: YTDLpChannelConfig): boolean {
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

    public applyConfig(config: YTDLpChannelConfig): void {
        super.applyConfig(config);
        if (config.schedule_enabled) {
            const wasAlreadyRunning = this.checkTimer !== undefined;
            void this.startWatching(wasAlreadyRunning);
        } else if (this.checkTimer) {
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
        return `yt-dlp: ${this.config?.url || "No URL"}`;
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

    public async toAPI(): Promise<ApiYTDLpChannel> {
        const api = await super.toAPI();
        const scheduleEnabled = this.config?.schedule_enabled ?? false;
        const ret: ApiYTDLpChannel = {
            ...api,
            provider: "ytdlp",
            icon_url: this.config?.icon_url,
            url: this.url,
            vods_list: await Promise.all(this.vods_list.map((v) => v.toAPI())) as unknown as ApiYTDLpVod[],
            next_check: (!scheduleEnabled || this.is_capturing) ? undefined : this.next_check?.toISOString(),
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
            log(LOGLEVEL.INFO, "ytdlp.startWatching", `Scheduling disabled for ${this.internalName}`);
            this.next_check = undefined;
            return false;
        }

        const interval = Helper.timeToMilliseconds(this.config.check_interval || 60, this.config.check_interval_unit || "seconds");
        this.checkStart = Date.now();
        this.next_check = new Date(Date.now() + interval);

        log(LOGLEVEL.INFO, "ytdlp.startWatching", `Starting scheduled checks for ${this.internalName} every ${interval / 1000}s`);

        this.checkTimer = setInterval(() => {
            this.next_check = new Date(Date.now() + interval);
            void this.checkStream();
        }, interval);

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
            this.broadcastUpdate();

            if (this.config?.max_check_duration && this.config.max_check_duration > 0 && this.checkStart) {
                const maxDuration = Helper.timeToMilliseconds(this.config.max_check_duration, this.config.max_check_duration_unit || "minutes");
                if (Date.now() - this.checkStart > maxDuration) {
                    log(LOGLEVEL.INFO, "ytdlp.checkStream", `Max check duration exceeded for ${this.internalName}, stopping checks.`);
                    void this.stopWatching();
                    return;
                }
            }

            if (await this.isLiveApi()) {
                log(LOGLEVEL.INFO, "ytdlp.checkStream", `Stream ${this.internalName} is live, starting capture.`);
                await this.downloadLatestVod("best");
            }
        } finally {
            this.isCheckingStream = false;
        }
    }

    public async isLiveApi(): Promise<boolean> {
        if (!this.config?.url) {
            log(LOGLEVEL.ERROR, "ytdlp.isLiveApi", `No URL configured for ${this.internalName}`);
            return false;
        }

        const ytdlp = Helper.path_youtubedl();
        if (!ytdlp) {
            log(LOGLEVEL.ERROR, "ytdlp.isLiveApi", `yt-dlp path not found for ${this.internalName}`);
            return false;
        }

        const args = ["--dump-json"];
        
        const cookiesPath = Config.getInstance().cfg<string>("ytdlp.cookies_path");
        const poToken = Config.getInstance().cfg<string>("ytdlp.po_token");

        let extractorArgs = "youtube:player-client=default,mweb";
        if (poToken) {
            extractorArgs += `;po_token=${poToken}`;
        }

        if (cookiesPath) {
            args.push("--cookies", cookiesPath);
        }
        args.push("--extractor-args", extractorArgs);
        args.push("--remote-components", "ejs:github");
        args.push(this.config!.url!);

        log(LOGLEVEL.DEBUG, "ytdlp.isLiveApi", `Checking if ${this.internalName} is live via ${ytdlp} ${args.join(" ")}`);

        return new Promise((resolve) => {
            const env = { ...process.env };
            delete env.NODE_OPTIONS;
            delete env.NODE_PATH;

            const child = spawn(ytdlp, args, {
                cwd: DataRoot,
                env: {
                    ...env,
                    PATH: `${process.env.PATH}:/root/.deno/bin:/root/.local/bin`
                }
            });

            let output = "";
            let stderr = "";
            child.stdout.on("data", (data: string) => output += data);
            child.stderr.on("data", (data: string) => stderr += data);

            child.on("error", (err: Error) => {
                log(LOGLEVEL.ERROR, "ytdlp.isLiveApi", `Failed to spawn yt-dlp for ${this.internalName}: ${err.message}`);
                resolve(false);
            });

            child.on("close", (code: number | null) => {
                log(LOGLEVEL.DEBUG, "ytdlp.isLiveApi", `yt-dlp process for ${this.internalName} closed with code ${code}`);
                if (code === 0) {
                    try {
                        const json = JSON.parse(output);
                        if (json.is_live) return resolve(true);
                        return resolve(false);
                    } catch (e) {
                        log(LOGLEVEL.ERROR, "ytdlp.isLiveApi", `Failed to parse yt-dlp output for ${this.internalName}: ${e}. Output: ${output}`);
                        resolve(false);
                    }
                } else {
                    log(LOGLEVEL.ERROR, "ytdlp.isLiveApi", `yt-dlp exited with code ${code} for ${this.internalName}. Stderr: ${stderr}`);
                    resolve(false);
                }
            });
        });
    }

    public async downloadLatestVod(quality: string): Promise<string> {
        const now = Date.now();
        const timestamp = new Date(now).toISOString().replace(/:/g, "_").replace(/\.\d{3}Z$/, "Z");
        const vod = await this.createVOD(path.join(this.getFolder(), `${this.internalName}_${timestamp}_${now}.json`), `${now}`);

        const automator = new YTDLpAutomator();
        automator.broadcaster_user_login = this.internalName;
        automator.channel = this as any;
        automator.vod = vod as YTDLpVOD;

        void automator.download();

        return vod.uuid;
    }

    public override async createVOD(filename: string, capture_id: string): Promise<BaseVOD> {
        this.makeFolder();
        const vod = new YTDLpVOD();
        vod.uuid = capture_id;
        vod.capture_id = capture_id;
        vod.filename = filename;
        vod.basename = path.basename(filename, ".json");
        vod.directory = path.dirname(filename);
        vod.channel_uuid = this.uuid;
        vod.created_at = new Date();

        vod.webpath = `${Config.getInstance().cfg<string>("basepath", "")}/vods/` +
            path.relative(BaseConfigDataFolder.vod, vod.directory);

        this.addVodToDatabase(path.relative(BaseConfigDataFolder.vod, filename));
        this.addVod(vod);

        await vod.saveJSON("create");

        this.saveVodDatabase();
        this.broadcastUpdate();
        return vod;
    }

    public override async exportAllVods(force = false): Promise<[number, number]> {
        // Implement bulk export for yt-dlp if needed, otherwise fallback to base
        return await super.exportAllVods(force);
    }

    public override getVods(): BaseVOD[] {
        return this.vods_list as BaseVOD[];
    }
}
