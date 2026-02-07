import type { ApiBaseChannel } from "@common/Api/Client";
import type { VideoQuality } from "@common/Config";
import type { BroadcasterType } from "@common/TwitchAPI/Users";
import type { BaseVODChapterJSON } from "../../../../../server/src/Storage/JSON";
import type { LocalVideo } from "@common/LocalVideo";
import type { LocalClip } from "@common/LocalClip";
import type { BaseVODChapter } from "./BaseVODChapter";
import type BaseVOD from "./BaseVOD";
import type { Providers } from "@common/Defs";

export default class BaseChannel {
    provider: Providers = "base";
    uuid = "";
    // userid = "";
    // display_name = "";
    // login = "";
    description = "";
    quality: VideoQuality[] = [];
    no_capture = false;
    broadcaster_type: BroadcasterType = "";

    profile_image_url = "";
    offline_image_url = "";
    banner_image_url = "";

    vods_raw: string[] = [];
    vods_list: BaseVOD[] = [];

    clips_list: LocalClip[] = [];
    video_list: LocalVideo[] = [];

    api_getSubscriptionStatus = false;

    // channel_data: UserData | undefined;

    current_stream_number = 0;
    current_season = "";
    is_live = false;
    // is_capturing = false;

    chapter_data?: BaseVODChapterJSON;

    saves_vods = false;
    schedule_enabled = false;
    check_interval = 60;
    check_interval_unit = "seconds";
    max_check_duration = -1;
    max_check_duration_unit = "minutes";

    download_vod_at_end = false;
    download_vod_at_end_quality: VideoQuality = "best";

    displayName = "";
    internalName = "";
    internalId = "";
    url = "";
    profilePictureUrl = "";

    next_check?: string;
    check_timeout?: string;

    public static makeFromApiResponse(apiResponse: ApiBaseChannel): BaseChannel {

        const channel = new BaseChannel();

        channel.provider = apiResponse.provider;
        channel.uuid = apiResponse.uuid;
        channel.displayName = apiResponse.displayName;
        channel.internalName = apiResponse.internalName;
        channel.internalId = apiResponse.internalId;
        channel.url = apiResponse.url;
        channel.profilePictureUrl = apiResponse.profilePictureUrl;
        channel.description = apiResponse.description;
        // channel.quality = apiResponse.quality || [];
        channel.vods_raw = apiResponse.vods_raw;
        channel.clips_list = apiResponse.clips_list;
        channel.video_list = apiResponse.video_list;
        channel.no_capture = apiResponse.no_capture;
        channel.is_live = apiResponse.is_live ?? false;
        channel.current_stream_number = apiResponse.current_stream_number ?? 0;
        channel.current_season = apiResponse.current_season ?? "";

        channel.next_check = apiResponse.next_check;
        channel.check_timeout = apiResponse.check_timeout;
        channel.schedule_enabled = apiResponse.schedule_enabled || false;
        channel.check_interval = apiResponse.check_interval || 60;
        channel.check_interval_unit = apiResponse.check_interval_unit || "seconds";
        channel.max_check_duration = apiResponse.max_check_duration || -1;
        channel.max_check_duration_unit = apiResponse.max_check_duration_unit || "minutes";

        return channel;
    }

    get current_vod(): BaseVOD | undefined {
        return this.vods_list?.find((vod) => vod.is_capturing);
    }

    // get is_live() {
    //     return this.current_vod != undefined && this.current_vod.is_capturing;
    // }

    get current_chapter(): BaseVODChapter | undefined {
        return this.current_vod?.current_chapter;
    }

    get is_capturing(): boolean {
        return this.current_vod != undefined && this.current_vod.is_capturing;
    }

    get is_converting(): boolean {
        return this.vods_list?.some((vod) => vod.is_converting) ?? false;
    }

    get vods_size(): number {
        return this.vods_list?.reduce((acc, vod) => acc + (vod.segments?.reduce((acc, seg) => acc + (seg && seg.filesize ? seg.filesize : 0), 0) ?? 0), 0) ?? 0;
    }
}
