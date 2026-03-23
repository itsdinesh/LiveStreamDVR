import type { ApiYTDLpChannel } from "@common/Api/Client";
import BaseChannel from "../Base/BaseChannel";
import type { Providers } from "@common/Defs";
import BaseVOD from "../Base/BaseVOD";

export default class YTDLpChannel extends BaseChannel {
    public readonly provider: Providers = "ytdlp";
    vods_list: BaseVOD[] = [];

    public static makeFromApiResponse(apiResponse: ApiYTDLpChannel): YTDLpChannel {
        const { provider, ...baseChannel } = BaseChannel.makeFromApiResponse(apiResponse);
        const channel = new YTDLpChannel();
        Object.assign(channel, baseChannel);
        channel.vods_list = apiResponse.vods_list.map((vod) => BaseVOD.makeFromApiResponse(vod));
        return channel;
    }

}
