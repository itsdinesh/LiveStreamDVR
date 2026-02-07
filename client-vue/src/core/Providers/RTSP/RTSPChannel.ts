import type { ApiRTSPChannel } from "@common/Api/Client";
import BaseChannel from "../Base/BaseChannel";
import BaseVOD from "../Base/BaseVOD";

export default class RTSPChannel extends BaseChannel {
    readonly provider = "rtsp";

    public static makeFromApiResponse(apiResponse: ApiRTSPChannel): RTSPChannel {
        const { provider, ...baseChannel } = BaseChannel.makeFromApiResponse(apiResponse);
        const channel = new RTSPChannel();
        Object.assign(channel, baseChannel);
        channel.vods_list = apiResponse.vods_list.map((vod) => BaseVOD.makeFromApiResponse(vod));
        // Copy provider-specific fields
        channel.next_check = apiResponse.next_check;
        channel.check_timeout = apiResponse.check_timeout;
        return channel;
    }
}
