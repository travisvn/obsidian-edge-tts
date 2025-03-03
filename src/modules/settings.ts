import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import EdgeTTSPlugin from '../main';

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

    containerEl.createEl('h3', { text: 'Extra Settings' });

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