import type { AxiosInstance } from "axios";
import type { YandexStorage } from "../../storage.js";
import type { YandexPassportAPI } from "./passport.js";
import { createHmac } from "crypto";
import qs from "querystring";
import { createInstance } from "../utils.js";

export class YandexMusicAPI {
    private client: AxiosInstance;

    constructor(storage: YandexStorage, private passport: YandexPassportAPI) {
        this.client = createInstance(storage, config => ({
            ...config,
            headers: {
                ...config.headers,
                "X-Yandex-Music-Client": "YandexMusicAndroid/24023621",
                "X-Yandex-Music-Content-Type": "adult"
            }
        }));

        this.client.interceptors.request.use(async request => {
            request.headers.set("Authorization", `OAuth ${ await this.passport.getMusicToken() }`);
            return request;
        });
    }

    get request() {
        return this.client;
    }

    async getAccountStatus() {
        return await this.client
            .get("https://api.music.yandex.net/account/status")
            .then(res => res.data.result);
    }

    async getTracks(trackIds: Array<string>) {
        return await this.client
            .post("https://api.music.yandex.net/tracks", qs.stringify({ "track-ids": trackIds }))
            .then(res => res.data.result);
    }

    async getTrack(trackId: string) {
        return await this.getTracks([trackId])
           .then(tracks => tracks[0]);
    }

    async getLyrics(trackId: string) {
        const timestamp = Math.round(Date.now() / 1000);
        const hmac = createHmac("sha256", "p93jhgh689SBReK6ghtw62")
            .update(`${trackId}${timestamp}`)
            .digest();
        
        const params = { timeStamp: timestamp, sign: hmac.toString("base64") };
        const lyricsUrl = await this.client
            .get(`https://api.music.yandex.net/tracks/${trackId}/lyrics`, { params })
            .then(res => res.data.result.downloadUrl);

        return await this.client
            .get(lyricsUrl)
            .then(res => res.data as string);
    }

    async getLikes(userId: string) {
        return await this.client
            .get(`https://api.music.yandex.net/users/${userId}/likes/tracks`)
            .then(res => res.data.result.library.tracks as any[]);
    }

    async addLike(userId: string, trackId: string, albumId: string) {
        const params = new URLSearchParams();
        params.append("track-ids", `${trackId}:${albumId}`);

        return await this.client
            .post(`https://api.music.yandex.net/users/${userId}/likes/tracks/add-multiple`, undefined, { params });
    }

    async removeLike(userId: string, trackId: string) {
        const params = new URLSearchParams();
        params.append("track-ids", `${trackId}`);

        return await this.client
            .post(`https://api.music.yandex.net/users/${userId}/likes/tracks/remove`, undefined, { params });
    }

    async getDislikes(userId: string) {
        return await this.client
            .get(`https://api.music.yandex.net/users/${userId}/dislikes/tracks`)
            .then(res => res.data.result.library.tracks as any[]);
    }

    async addDislike(userId: string, trackId: string, albumId: string) {
        const params = new URLSearchParams();
        params.append("track-ids", `${trackId}:${albumId}`);

        return await this.client
            .post(`https://api.music.yandex.net/users/${userId}/dislikes/tracks/add-multiple`, undefined, { params });
    }

    async removeDislike(userId: string, trackId: string) {
        const params = new URLSearchParams();
        params.append("track-ids", `${trackId}`);

        return await this.client
            .post(`https://api.music.yandex.net/users/${userId}/dislikes/tracks/remove`, undefined, { params });
    }
}