import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import EdgeTTSPlugin from '../main';
import { APP_STORE_LINKS } from './constants';

// Import SVG content as strings
// eslint-disable-next-line @typescript-eslint/no-var-requires
const googlePlayIconSvg = require('../assets/google-play-icon.svg');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appleAppStoreIconSvg = require('../assets/apple-app-store.svg');

// Settings interface and default settings
export interface EdgeTTSPluginSettings {
  selectedVoice: string;
  customVoice: string;
  playbackSpeed: number;

  showNotices: boolean;
  showStatusBarButton: boolean;
  showMenuItems: boolean;

  generateMP3: boolean;
  outputFolder: string;
  embedInNote: boolean;
  replaceSpacesInFilenames: boolean;

  overrideAmpersandEscape: boolean;
  floatingPlayerPosition: { x: number; y: number } | null;
  disablePlaybackControlPopover: boolean;
  enableReplayOption: boolean;
}

// Top voices to be displayed in the dropdown
export const TOP_VOICES = [
  'en-US-AvaMultilingualNeural',
  'en-US-BrianMultilingualNeural',
  'en-US-AndrewNeural',
  'en-US-AriaNeural',
  'en-US-AvaNeural',
  'en-US-ChristopherNeural',
  'en-US-SteffanNeural',
  'en-IE-ConnorNeural',
  'en-GB-RyanNeural',
  'en-GB-SoniaNeural',
  'en-AU-NatashaNeural',
  'en-AU-WilliamNeural',
];

export const DEFAULT_SETTINGS: EdgeTTSPluginSettings = {
  selectedVoice: 'en-US-AvaNeural',
  customVoice: '',
  playbackSpeed: 1.0,

  showNotices: true,
  showStatusBarButton: true,
  showMenuItems: true,

  generateMP3: false,
  outputFolder: 'Note Narration Audio',
  embedInNote: false,
  replaceSpacesInFilenames: false,

  overrideAmpersandEscape: false,
  floatingPlayerPosition: null,
  disablePlaybackControlPopover: false,
  enableReplayOption: true,
}

export const defaultSelectedTextMp3Name = 'note';

export class EdgeTTSPluginSettingTab extends PluginSettingTab {
  plugin: EdgeTTSPlugin;

  constructor(app: App, plugin: EdgeTTSPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    // Add a text notice about sampling voices
    const inbetweenInfo = containerEl.createEl('div', {
      cls: 'edge-tts-info-div'
    })

    const infoText = document.createElement('p');
    const secondLink = document.createElement('a');
    secondLink.href = 'https://tts.travisvn.com';
    secondLink.text = 'tts.travisvn.com';
    infoText.append('You can sample available voices at ');
    infoText.append(secondLink);

    inbetweenInfo.appendChild(infoText)

    // Dropdown for top voices
    new Setting(containerEl)
      .setName('Select voice')
      .setDesc('Choose from the top voices.')
      .setClass('default-style')
      .addDropdown(dropdown => {
        TOP_VOICES.forEach(voice => {
          dropdown.addOption(voice, voice);
        });
        dropdown.setValue(this.plugin.settings.selectedVoice);
        dropdown.onChange(async (value) => {
          this.plugin.settings.selectedVoice = value;
          await this.plugin.saveSettings();
        });
      });

    const patternFragment = document.createDocumentFragment();
    const link = document.createElement('a');
    link.href = 'https://tts.travisvn.com';
    link.text = 'tts.travisvn.com';
    patternFragment.append('(OPTIONAL) Enter custom voice. Visit ');
    patternFragment.append(link);
    patternFragment.append(' for list of options. ');
    patternFragment.append('Leave empty to use the selected voice above.');

    // Text input for custom voice
    new Setting(containerEl)
      .setName('Custom voice')
      .setDesc(patternFragment)
      .addText(text => {
        text.setPlaceholder('e.g., fr-FR-HenriNeural');
        text.setValue(this.plugin.settings.customVoice);
        text.onChange(async (value) => {
          this.plugin.settings.customVoice = value;
          await this.plugin.saveSettings();
        });
      });

    // Slider for playback speed
    new Setting(containerEl)
      .setName('Playback speed')
      .setDesc('Change playback speed multiplier (ex. 0.5 = 0.5x playback speed (50% speed)). Default = 1.0')
      .addSlider(slider => {
        slider.setLimits(0.5, 2.0, 0.1);
        slider.setValue(this.plugin.settings.playbackSpeed);
        slider.onChange(async (value) => {
          this.plugin.settings.playbackSpeed = value;
          await this.plugin.saveSettings();
        });
        slider.setDynamicTooltip();
        slider.showTooltip();
      });

    // Notice toggle setting
    new Setting(containerEl)
      .setName('Show notices')
      .setDesc('Toggle notices for processing status and errors.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.showNotices);
        toggle.onChange(async (value) => {
          this.plugin.settings.showNotices = value;
          await this.plugin.saveSettings();
        });
      });

    // Status toggle setting
    new Setting(containerEl)
      .setName('Show status bar button')
      .setDesc('Toggle playback button in the status bar.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.showStatusBarButton);
        toggle.onChange(async (value) => {
          this.plugin.settings.showStatusBarButton = value;
          await this.plugin.saveSettings();
          if (value) {
            this.plugin.uiManager.initializeStatusBar();
          } else {
            this.plugin.uiManager.removeStatusBarButton();
          }
        });
      });

    // Menu items toggle setting
    new Setting(containerEl)
      .setName('Show file and editor menu items')
      .setDesc('Toggle menu items in the file and editor menus.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.showMenuItems);
        toggle.onChange(async (value) => {
          this.plugin.settings.showMenuItems = value;
          await this.plugin.saveSettings();
          if (value) {
            this.plugin.uiManager.addPluginMenuItems();
          } else {
            new Notice('Menu items will be removed after the next reload.');
          }
        });
      });

    // New setting for disabling playback control popover
    new Setting(containerEl)
      .setName('Disable floating playback controls')
      .setDesc('Hide the floating playback control popover during audio playback.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.disablePlaybackControlPopover);
        toggle.onChange(async (value) => {
          this.plugin.settings.disablePlaybackControlPopover = value;
          await this.plugin.saveSettings();
          // Optionally, inform the user or trigger UI update if needed immediately
          new Notice(`Floating playback controls ${value ? 'disabled' : 'enabled'}.`);
        });
      });

    // New setting for enabling replay option
    new Setting(containerEl)
      .setName('Enable replay option')
      .setDesc('Keep playback controls open after audio finishes to allow replaying.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.enableReplayOption);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableReplayOption = value;
          await this.plugin.saveSettings();
          new Notice(`Replay option ${value ? 'enabled' : 'disabled'}.`);
        });
      });

    containerEl.createEl('h3', { text: 'Saving .mp3 of narration' });

    new Setting(containerEl)
      .setName('Generate MP3 file')
      .setDesc('Enable option to select "Generate MP3" in the file and editor menus.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.generateMP3);
        toggle.onChange(async (value) => {
          this.plugin.settings.generateMP3 = value;
          await this.plugin.saveSettings();
          if (!value) {
            new Notice('Menu items will be removed after the next reload.');
          }
        });
      });

    new Setting(containerEl)
      .setName('Output folder')
      .setDesc('Specify the folder to save generated MP3 files.')
      .addText(text => {
        text.setPlaceholder('e.g., Note Narration Audio')
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Embed MP3 in note')
      .setDesc('Embed a link to the generated MP3 file in the note.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.embedInNote);
        toggle.onChange(async (value) => {
          this.plugin.settings.embedInNote = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Replace spaces in filenames')
      .setDesc('Replaces spaces in mp3 file name with underscores (used for system compatibility).')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.replaceSpacesInFilenames);
        toggle.onChange(async (value) => {
          this.plugin.settings.replaceSpacesInFilenames = value;
          await this.plugin.saveSettings();
        });
      });

    // --- Add Mobile App Section --- 
    const mobileAppSection = containerEl.createDiv({ cls: 'edge-tts-mobile-app-section' });
    mobileAppSection.createEl('h3', { text: '📱 Mobile support' });
    mobileAppSection.createEl('p', {
      text: 'Create audio narration for your Obsidian notes using our free mobile app.'
    });

    const buttonContainer = mobileAppSection.createDiv({ cls: 'edge-tts-app-store-buttons' });

    // Google Play Button
    const googlePlayButton = buttonContainer.createEl('a', {
      cls: 'edge-tts-app-store-button',
      href: APP_STORE_LINKS.googlePlay,
      attr: { target: '_blank', rel: 'noopener' }
    });
    // Set SVG Icon from imported file
    googlePlayButton.innerHTML = googlePlayIconSvg;
    const googlePlaySvgElement = googlePlayButton.querySelector('svg');
    if (googlePlaySvgElement) {
      googlePlaySvgElement.addClass('edge-tts-app-store-icon'); // Add a common class if needed for sizing
    }
    googlePlayButton.createSpan({ text: 'Google Play' });

    // Apple App Store Button
    const appleStoreButton = buttonContainer.createEl('a', {
      cls: 'edge-tts-app-store-button',
      href: APP_STORE_LINKS.appleAppStore,
      attr: { target: '_blank', rel: 'noopener' }
    });
    // Set SVG Icon from imported file
    appleStoreButton.innerHTML = appleAppStoreIconSvg;
    const appleStoreSvgElement = appleStoreButton.querySelector('svg');
    if (appleStoreSvgElement) {
      appleStoreSvgElement.addClass('edge-tts-app-store-icon'); // Add a common class if needed for sizing
    }
    appleStoreButton.createSpan({ text: 'App Store' });
    // --- End Mobile App Section ---

    const starContainer = containerEl.createEl('div', { cls: 'edge-tts-star-section' });
    starContainer.createEl('p', {
      text: 'Please star this project on GitHub if you find it useful ⭐️',
      cls: 'edge-tts-star-message'
    });

    starContainer.createEl('a', {
      text: 'GitHub: Edge TTS Plugin',
      href: 'https://github.com/travisvn/obsidian-edge-tts',
      cls: 'external-link',
      attr: {
        target: '_blank',
        rel: 'noopener'
      }
    });

    containerEl.createEl('h3', { text: 'Extra settings' });

    new Setting(containerEl)
      .setName('Override ampersand (&) escaping')
      .setDesc('If an ampersand (&) is by itself, we "escape it" for the API call. This override is an option for rare use cases.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.overrideAmpersandEscape);
        toggle.onChange(async (value) => {
          this.plugin.settings.overrideAmpersandEscape = value;
          await this.plugin.saveSettings();
        });
      });
  }
} 