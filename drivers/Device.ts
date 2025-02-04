import Homey from "homey";
import { Yandex } from "../library/index.js";
import { YandexSpeaker } from "../library/client/home/devices/speaker.js";
import { YandexSpeakerState } from "../library/client/home/typings.js";

export default class Device extends Homey.Device {
    private id!: string;
    private yandex!: Yandex;
    private speaker?: YandexSpeaker;
    private image!: Homey.Image;

    private userId!: string;
    private waitings: Record<string, number> = {};
    private aliceActive: boolean = false;

    private lastTrackId: string = "";
    private lastTrackAlbumId: string = "";
    private lastTrackImage: string = "https://";
    private lastTrackLyrics: Array<string> = [];
    private lastTrackLyricsTimeout?: NodeJS.Timeout;
    
    async onInit() {
        const data = this.getData();
        this.id = data.id as string;
        this.yandex = (this.homey.app as any).yandex;

        // Значение по умолчанию при создании колонки
        this.getCapabilityValue("speaker_playing") ??
            await this.setCapabilityValue("speaker_playing", false);

        // Создание и установка обложки
        this.image = await this.homey.images.createImage();
        await this.setAlbumArtImage(this.image);

        // Регистрация свойств
        this.registerCapabilities();

        // Получение идентификатора пользователя
        const accountStatus = await this.yandex.api.music.getAccountStatus();
        this.userId = String(accountStatus.account.uid);

        await this.getSpeaker().catch(this.error);
    }

    async onDeleted() {
        if (!this.speaker) return;
        await this.speaker.destroy();
    }

    async getSpeaker() {
        if (!this.speaker) {
            this.speaker = await this.yandex.home.createSpeaker(this.id);
            this.speaker.state.volume = this.getCapabilityValue("volume_set") ?? 0;
            this.speaker.state.playing = this.getCapabilityValue("speaker_playing");
            this.speaker.on("state", this.handleState);
            await this.speaker.connect();
        }
        return this.speaker;
    }

    private registerCapabilities() {
        this.registerCapabilityListener("speaker_playing", async value => {
            this.waitings["speaker_playing"] = Date.now();
            const speaker = await this.getSpeaker();
            if (value) await speaker.mediaPlay();
            else await speaker.mediaPause();
        });

        this.registerCapabilityListener("volume_set", async value => {
            this.waitings["volume_set"] = Date.now();
            const speaker = await this.getSpeaker();
            await speaker.volumeSet(value);
        });

        this.registerCapabilityListener("speaker_next", async () => {
            const speaker = await this.getSpeaker();
            await speaker.mediaNext();
        });

        this.registerCapabilityListener("speaker_prev", async () => {
            const speaker = await this.getSpeaker();
            await speaker.mediaPrev();
        });

        this.registerCapabilityListener("speaker_shuffle", async value => {
            this.waitings["speaker_shuffle"] = Date.now();
            const speaker = await this.getSpeaker();
            await speaker.musicShuffle(value);
        });

        this.registerCapabilityListener("speaker_repeat", async value => {
            const modes = { none: "none", track: "one", playlist: "all" } as any;
            const mode = modes[value];

            this.waitings["speaker_repeat"] = Date.now();
            const speaker = await this.getSpeaker();
            await speaker.musicRepeat(mode);
        });

        this.registerCapabilityListener("media_rewind", async value => {
            this.waitings["media_rewind"] = Date.now();
            const speaker = await this.getSpeaker();
            await speaker.mediaRewind(value);
        });

        this.registerCapabilityListener("media_lyrics", async value => {
            const speaker = await this.getSpeaker();
            await speaker.mediaRewind(Number(value));
            clearTimeout(this.lastTrackLyricsTimeout);
            this.lastTrackLyricsTimeout = undefined;
        });

        this.hasCapability("media_like") && this.registerCapabilityListener("media_like", async value => {
            if (!this.lastTrackId || !this.lastTrackAlbumId) return;
            if (value) {
                await this.yandex.api.music.addLike(this.userId, this.lastTrackId, this.lastTrackAlbumId);
                return await this.setCapabilityValue("media_dislike", false);
            }
            await this.yandex.api.music.removeLike(this.userId, this.lastTrackId);
        });

        this.hasCapability("media_dislike") && this.registerCapabilityListener("media_dislike", async value => {
            if (!this.lastTrackId || !this.lastTrackAlbumId) return;
            if (value) {
                await this.yandex.api.music.addDislike(this.userId, this.lastTrackId, this.lastTrackAlbumId);
                return await this.setCapabilityValue("media_like", false);
            }
            await this.yandex.api.music.removeDislike(this.userId, this.lastTrackId);
        });

        this.hasCapability("media_power") && this.registerCapabilityListener("media_power", async value => {
            const speaker = await this.getSpeaker();
            await speaker.controlPower(value);
        });

        this.hasCapability("media_home") && this.registerCapabilityListener("media_home", async () => {
            const speaker = await this.getSpeaker();
            await speaker.controlHome();
        });

        this.hasCapability("media_left") && this.registerCapabilityListener("media_left", async () => {
            const speaker = await this.getSpeaker();
            await speaker.controlLeft();
        });

        this.hasCapability("media_right") && this.registerCapabilityListener("media_right", async () => {
            const speaker = await this.getSpeaker();
            await speaker.controlRight();
        });

        this.hasCapability("media_up") && this.registerCapabilityListener("media_up", async () => {
            const speaker = await this.getSpeaker();
            await speaker.controlUp();
        });

        this.hasCapability("media_down") && this.registerCapabilityListener("media_down", async () => {
            const speaker = await this.getSpeaker();
            await speaker.controlDown();
        });

        this.hasCapability("media_back") && this.registerCapabilityListener("media_back", async () => {
            const speaker = await this.getSpeaker();
            await speaker.controlBack();
        });

        this.hasCapability("media_click") && this.registerCapabilityListener("media_click", async () => {
            const speaker = await this.getSpeaker();
            await speaker.controlClick();
        });
    }
    
    private handleState = async (state: Partial<YandexSpeakerState>) => {
        const capabilities: Record<string, any> = {
            "speaker_playing": state.playing || false,
            "speaker_shuffle": state.playerState?.entityInfo?.shuffled || false,
            "speaker_repeat": state.playerState?.entityInfo?.repeatMode || "None",
            "speaker_duration": state.playerState?.duration || 0,
            "speaker_position": state.playerState?.progress || 0,
            "volume_set": state.volume || this.getCapabilityValue("volume_set"),
            "media_rewind": Math.round(state.playerState?.progress || 0)
        };

        const repeatMode = { None: "none", One: "track", All: "playlist" } as any;
        capabilities.speaker_repeat = capabilities.speaker_repeat && repeatMode[capabilities.speaker_repeat];

        const rewindOptions = this.getCapabilityOptions("media_rewind");
        if (capabilities.speaker_duration && capabilities.speaker_duration !== rewindOptions.max) {
            await this.setCapabilityOptions("media_rewind", { min: 0, max: capabilities.speaker_duration, step: 1 });
        }

        // Для нового трека
        const trackId = state.playerState?.id || "";
        if (trackId !== this.lastTrackId) {
            const track = await this.yandex.api.music.getTrack(trackId).catch(() => undefined);
            this.lastTrackId = track?.id || trackId;
            this.lastTrackAlbumId = track?.albums?.[0]?.id || "";
            this.lastTrackLyrics = [];

            const [likes, dislikes] = await Promise.all([
                this.yandex.api.music.getLikes(this.userId).catch(() => [] as any[]),
                this.yandex.api.music.getDislikes(this.userId).catch(() => [] as any[]),
                this.updateTrackCover(state, track),
                this.updateTrackLyrics(state, track)
            ]);

            capabilities["speaker_track"] = track?.title || state.playerState?.title || "";
            capabilities["speaker_artist"] = track?.artists?.map((a: any) => a.name)?.join(", ") || state.playerState?.subtitle || "";
            capabilities["speaker_album"] = track?.albums?.[0]?.title || state.playerState?.playlistId || "";
            capabilities["media_like"] = likes.find(like => like.id === track?.id) ? true : false;
            capabilities["media_dislike"] = dislikes.find(dislike => dislike.id === track?.id) ? true : false;
        }

        await this.handleLyricsSync(state);
        await this.handleAliceState(state);

        await Promise.all(
            Object.entries(capabilities).map(async ([capability, value]) => {
                if (Object.keys(this.waitings).includes(capability)) {
                    if (Date.now() - this.waitings[capability] >= 3000)
                        delete this.waitings[capability];
                    return Promise.resolve();
                }

                const currentValue = this.getCapabilityValue(capability);
                if (currentValue !== value)
                    await this.setCapabilityValue(capability, value).catch(this.error);
            })
        );
    };

    private async updateTrackCover(state: Partial<YandexSpeakerState>, track?: any) {
        const trackImage = track?.coverUri || track?.ogImage || state.playerState?.extra?.coverURI || "";
        const imageQuality = this.getSetting("image_quality") || 500;
        
        this.lastTrackImage = "https://" + trackImage.replace("%%", `${imageQuality}x${imageQuality}`);
        this.image.setUrl(this.lastTrackImage);
        await this.image.update();
    }

    private async updateTrackLyrics(state: Partial<YandexSpeakerState>, track?: any) {
        const trackId = state.playerState?.id || track?.id;
        let lyricsValues = [{ id: "none", title: "Нет текста песни" }];

        if (track?.lyricsInfo?.hasAvailableSyncLyrics) {
            const lyrics = await this.yandex.api.music.getLyrics(trackId).catch(() => "");
            const lyricsLines = lyrics.split("\n");
            const values = lyricsLines.map(line => {
                const time = line.split("[")[1].split("] ")[0];
                const timeColons = time.split(":").map(c => Number(c));
                const timeSeconds = String((timeColons[0] * 60) + timeColons[1]);
                const title = line.replace(`[${time}] `, "") || "-";

                this.lastTrackLyrics.push(timeSeconds);
                return { id: timeSeconds, title };
            });
            values.length && (lyricsValues = values);
        }

        await this.setCapabilityOptions("media_lyrics", { values: lyricsValues });
    }

    private async handleLyricsSync(state: Partial<YandexSpeakerState>) {
        const position = state.playerState?.progress;

        if (position !== undefined && this.lastTrackLyrics.length) {
            const closest = this.lastTrackLyrics.find(s => Number(s) >= position) || this.lastTrackLyrics[0];
            const between = Number(closest) - position;

            if (between > 0 && !this.lastTrackLyricsTimeout) {
                this.lastTrackLyricsTimeout = setTimeout(async () => {
                    this.lastTrackLyricsTimeout = undefined;
                    this.lastTrackLyrics.includes(closest) &&
                        await this.setCapabilityValue("media_lyrics", closest).catch(this.error);
                }, between * 1000);
            }
        }
    }

    private async handleAliceState(state: Partial<YandexSpeakerState>) {
        const aliceState = state.aliceState || "";

        if (!this.aliceActive && (aliceState === "LISTENING" || aliceState === "SPEAKING")) {
            this.aliceActive = true;
            this.image.setUrl("https://i.imgur.com/vTa3rif.png");
            await this.image.update();
            
            const listener = async (state: Partial<YandexSpeakerState>) => {
                if (state.aliceState !== "IDLE") return;
                this.aliceActive = false;
                this.image.setUrl(this.lastTrackImage);
                await this.image.update();

                this.speaker?.off("state", listener);
            };
            this.speaker?.on("state", listener);
        }
    }
}