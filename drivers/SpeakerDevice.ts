import Homey from "homey";
import { SpeakerData } from "../lib/modules/devices/types";
import YandexSpeaker from "../lib/modules/devices/types/speaker";
import Yandex from "../lib/yandex";

export default class SpeakerDevice extends Homey.Device {
    app!: Homey.App;
    yandex!: Yandex;
    device!: YandexSpeaker;
    image!: Homey.Image;

    async onInit(): Promise<void> {
        this.app = this.homey.app;
        //@ts-ignore
        this.yandex = this.app.yandex;
        this.image = await this.app.homey.images.createImage();
        await this.setAlbumArtImage(this.image);
        await this.onMultipleCapabilityListener();

        this.device = await this.yandex.devices.initSpeaker(this.getData().id);
        this.device.on("available", async () => {
            await this.setSettings({ x_token: this.homey.settings.get("x_token"), cookies: this.homey.settings.get("cookies") });
            await this.updateSettings(this.device.data);
            await this.setAvailable();
        });
        this.device.on("unavailable", async (reason: "NO_AUTH" | "REMOVED" | "CLOSED") => {
            if (reason === "NO_AUTH") await this.setUnavailable(this.homey.__("device.reauth_required"));
            if (reason === "REMOVED") await this.setUnavailable("Устройство больше не существует в Яндексе");
        });
        this.device.on("update", this.updateSettings)
        this.device.on("state", async (state) => await this.setCapabilities(state));
    }

    async onDeleted(): Promise<void> {
        await this.device.setUnavailable();
    }

    async setCapabilities(state: any) {
        const { volume, playing, playerState } = state;
        if (volume !== undefined) await this.setCapabilityValue("volume_set", volume * 10);
        if (playing !== undefined) await this.setCapabilityValue("speaker_playing", playing);
        if (playerState) {
            const { title, subtitle, duration, progress, extra } = playerState;
            if (title !== undefined) await this.setCapabilityValue("speaker_track", title);
            if (subtitle !== undefined) await this.setCapabilityValue("speaker_artist", subtitle);
            if (duration !== undefined) await this.setCapabilityValue("speaker_duration", duration);
            if (progress !== undefined) await this.setCapabilityValue("speaker_position", progress);
            if (extra?.coverURI !== undefined) {
                this.image.setUrl(`https://${(<string>extra.coverURI).replace("%%", "600x600")}`);
                await this.image.update();
            }
        }
    }

    async onMultipleCapabilityListener() {
        if (this.hasCapability("speaker_time_visualization"))
            this.registerCapabilityListener("speaker_time_visualization", async (value) => {
                (<SpeakerData>this.device.data).settings.quasar_config.led!.time_visualization.size = value;
                await this.device.setSettings();
            });

        if (this.hasCapability("speaker_music_equalizer_visualization"))
            this.registerCapabilityListener("speaker_music_equalizer_visualization", async (value) => {
                const data = (<SpeakerData>this.device.data).settings.quasar_config.led!.music_equalizer_visualization;
                if (value === "auto") data.auto = true;
                else {
                    data.auto = false;
                    data.style = value;
                }
                await this.device.setSettings();
            });

        this.registerCapabilityListener("button.reauth", async () => await this.yandex.logout());
        this.registerCapabilityListener("volume_set", async (volume) => await this.device.volumeSet(volume));
        this.registerCapabilityListener("volume_up", async () => await this.device.volumeUp());
        this.registerCapabilityListener("volume_down", async () => await this.device.volumeDown());
        this.registerCapabilityListener("speaker_playing", async (value) => value ? await this.device.play() : await this.device.pause());
        this.registerCapabilityListener("speaker_next", async () => await this.device.next());
        this.registerCapabilityListener("speaker_prev", async () => await this.device.prev());
    }

    // Настройки
    updateSettings = async (data: SpeakerData) => {
        if (this.hasCapability("speaker_time_visualization"))
            await this.setCapabilityValue("speaker_time_visualization", (<SpeakerData>this.device.data).settings.quasar_config.led!.time_visualization.size);
        
        if (this.hasCapability("speaker_music_equalizer_visualization"))
            await this.setCapabilityValue("speaker_music_equalizer_visualization",
                (<SpeakerData>this.device.data).settings.quasar_config.led!.music_equalizer_visualization.auto ? "auto" :
                (<SpeakerData>this.device.data).settings.quasar_config.led!.music_equalizer_visualization.style
            );
        
        if ((<SpeakerData>this.device.data).settings.quasar_config.led) {
            const { brightness } = (<SpeakerData>this.device.data).settings.quasar_config.led!;
            await this.setSettings({ auto_brightness: brightness.auto, brightness: brightness.value });
        }
    }

    async onSettings({ newSettings, changedKeys }: { oldSettings: any; newSettings: any; changedKeys: string[]; }): Promise<string | void> {
        if ((<SpeakerData>this.device.data).settings.quasar_config.led) {
            const { brightness } = (<SpeakerData>this.device.data).settings.quasar_config.led!;

            changedKeys.forEach(key => {
                const value = newSettings[key];
                if (key === "auto_brightness") brightness.auto = value;
                if (key === "brightness") brightness.value = value / 100;
            });

            await this.device.setSettings();
        }

        return this.homey.__("device.save_settings");
    }
}