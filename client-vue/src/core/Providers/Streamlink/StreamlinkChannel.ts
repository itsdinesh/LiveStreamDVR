import type { ApiStreamlinkChannel } from "@common/Api/Client";
import BaseChannel from "../Base/BaseChannel";
import BaseVOD from "../Base/BaseVOD";

export default class StreamlinkChannel extends BaseChannel {
    readonly provider = "streamlink";

    public static makeFromApiResponse(apiResponse: ApiStreamlinkChannel): StreamlinkChannel {
        const { provider, ...baseChannel } = BaseChannel.makeFromApiResponse(apiResponse);
        const channel = new StreamlinkChannel();
        Object.assign(channel, baseChannel);
        channel.vods_list = apiResponse.vods_list.map((vod) => BaseVOD.makeFromApiResponse(vod)); // Use BaseVOD for now
        // Copy provider-specific fields
        channel.next_check = apiResponse.next_check;
        channel.check_timeout = apiResponse.check_timeout;
        return channel;
    }
}
