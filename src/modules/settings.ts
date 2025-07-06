import { App, Notice, PluginSettingTab, Setting, Platform } from 'obsidian';
import EdgeTTSPlugin from '../main';
import { APP_STORE_LINKS } from './constants';
import { detectUserLanguage } from '../utils';
import { COMPARISON_SYMBOL_TRANSLATIONS } from '../lib/translations';

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

  // Text filtering settings
  textFiltering: {
    filterFrontmatter: boolean;
    filterMarkdownLinks: boolean;
    filterCodeBlocks: boolean;
    filterInlineCode: boolean;
    filterHtmlTags: boolean;
    filterTables: boolean;
    filterImages: boolean;
    filterFootnotes: boolean;
    filterComments: boolean;
    filterMathExpressions: boolean;
    filterWikiLinks: boolean;
    filterHighlights: boolean;
    filterCallouts: boolean;
    replaceComparisonSymbols: boolean;
  };

  // Symbol replacement settings
  symbolReplacement: {
    enableCustomReplacements: boolean;
    language: string; // 'auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'custom'
    customReplacements: {
      greaterThan: string;
      lessThan: string;
      greaterThanOrEqual: string;
      lessThanOrEqual: string;
    };
  };

  // overrideAmpersandEscape: boolean; // No longer needed - edge-tts-universal handles XML escaping internally
  floatingPlayerPosition: { x: number; y: number } | null;
  disablePlaybackControlPopover: boolean;
  enableReplayOption: boolean;
  enableQueueFeature: boolean;
  queueManagerPosition: { x: number; y: number } | null;
  autoPauseOnWindowBlur: boolean;
  chunkSize: number;

  // Experimental and mobile-specific features
  enableExperimentalFeatures: boolean;
  reducedNoticesOnMobile: boolean;
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

  // Text filtering settings
  textFiltering: {
    filterFrontmatter: true,
    filterMarkdownLinks: false, // Disabled by default
    filterCodeBlocks: true,
    filterInlineCode: true,
    filterHtmlTags: true,
    filterTables: true, // This might be one the user wants to adjust
    filterImages: true,
    filterFootnotes: true,
    filterComments: true,
    filterMathExpressions: false,
    filterWikiLinks: false,
    filterHighlights: true, // (this just removes the == — the text should remain)
    filterCallouts: false, // Keep callouts by default
    replaceComparisonSymbols: true, // Enable by default to prevent XML issues
  },

  // Symbol replacement settings
  symbolReplacement: {
    enableCustomReplacements: false, // Disabled by default, uses built-in language detection
    language: 'auto', // Auto-detect based on user locale
    customReplacements: {
      greaterThan: ' greater than ',
      lessThan: ' less than ',
      greaterThanOrEqual: ' greater than or equal to ',
      lessThanOrEqual: ' less than or equal to ',
    },
  },

  // overrideAmpersandEscape: false, // No longer needed - edge-tts-universal handles XML escaping internally
  floatingPlayerPosition: null,
  disablePlaybackControlPopover: false,
  enableReplayOption: true,
  enableQueueFeature: true,
  queueManagerPosition: null,
  autoPauseOnWindowBlur: false,
  chunkSize: 9000,

  // Experimental and mobile-specific features
  enableExperimentalFeatures: false,
  reducedNoticesOnMobile: true, // Default to true for better mobile UX
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

    // New setting for enabling queue feature
    new Setting(containerEl)
      .setName('Enable queue feature')
      .setDesc('Enable the playback queue functionality including queue manager and queue-related commands.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.enableQueueFeature);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableQueueFeature = value;
          await this.plugin.saveSettings();
          new Notice(`Queue feature ${value ? 'enabled' : 'disabled'}. Restart Obsidian to fully apply changes.`);
        });
      });

    // New setting for auto-pause on window blur
    new Setting(containerEl)
      .setName('Auto-pause on window focus loss')
      .setDesc('Automatically pause playback when Obsidian loses focus and resume when it regains focus.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.autoPauseOnWindowBlur);
        toggle.onChange(async (value) => {
          this.plugin.settings.autoPauseOnWindowBlur = value;
          await this.plugin.saveSettings();
          new Notice(`Auto-pause on focus loss ${value ? 'enabled' : 'disabled'}.`);
        });
      });

    containerEl.createEl('h3', { text: 'Saving .mp3 of narration' });

    // Only show MP3 generation options on desktop
    if (!Platform.isMobile) {
      // Add information about chunked generation
      const chunkedInfo = containerEl.createEl('div', {
        cls: 'edge-tts-info-div'
      });

      const chunkedInfoText = document.createElement('p');
      chunkedInfoText.style.fontSize = '13px';
      chunkedInfoText.style.color = 'var(--text-muted)';
      chunkedInfoText.innerHTML = `
        <strong>Note:</strong> For long notes (over ~1500 words or 9000 characters), MP3 generation will automatically use 
        a chunked approach. This splits the text into smaller parts, generates audio for each part, then combines them. 
        A progress indicator will show the status of each chunk during generation.
      `;
      chunkedInfo.appendChild(chunkedInfoText);

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
    } else {
      // Show mobile notice
      const mobileNotice = containerEl.createEl('div', {
        cls: 'edge-tts-info-div'
      });

      const mobileNoticeText = document.createElement('p');
      mobileNoticeText.style.fontSize = '13px';
      mobileNoticeText.style.color = 'var(--text-muted)';
      mobileNoticeText.innerHTML = `
        <strong>Note:</strong> MP3 file generation is not available on mobile devices due to file system limitations. 
        However, you can still use the audio playback feature to listen to your notes.
      `;
      mobileNotice.appendChild(mobileNoticeText);
    }

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

    containerEl.createEl('h3', { text: 'Advanced settings' });

    // Experimental features toggle
    new Setting(containerEl)
      .setName('Enable experimental features')
      .setDesc('Enable access to experimental features that may not be fully stable. These features are gated behind this toggle for safety.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.enableExperimentalFeatures);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableExperimentalFeatures = value;
          await this.plugin.saveSettings();
          new Notice(`Experimental features ${value ? 'enabled' : 'disabled'}.`);
        });
      });

    // Mobile-specific settings
    if (Platform.isMobile) {
      new Setting(containerEl)
        .setName('Reduced notices on mobile')
        .setDesc('Show fewer notification popups on mobile devices to reduce screen clutter. Disable this for more verbose feedback.')
        .addToggle(toggle => {
          toggle.setValue(this.plugin.settings.reducedNoticesOnMobile);
          toggle.onChange(async (value) => {
            this.plugin.settings.reducedNoticesOnMobile = value;
            await this.plugin.saveSettings();
            new Notice(`Mobile notices ${value ? 'reduced' : 'verbose'}.`);
          });
        });
    }

    // Create collapsible text filtering section
    const textFilteringHeader = containerEl.createEl('div', {
      cls: 'setting-item setting-item-heading edge-tts-collapsible-header',
      attr: { style: 'cursor: pointer; user-select: none;' }
    });

    const textFilteringTitle = textFilteringHeader.createEl('div', { cls: 'setting-item-info' });
    const titleContainer = textFilteringTitle.createEl('div', { cls: 'setting-item-name' });

    // Add arrow icon and title
    const arrow = titleContainer.createEl('span', {
      text: '▶ ',
      attr: { style: 'display: inline-block; transition: transform 0.2s ease; margin-right: 8px;' }
    });
    titleContainer.createSpan({ text: 'Text filtering' });

    // Add description
    textFilteringTitle.createEl('div', {
      cls: 'setting-item-description',
      text: 'Configure what content is filtered from notes before speech generation. Click to expand options.'
    });

    // Create collapsible content container
    const textFilteringContent = containerEl.createEl('div', {
      attr: {
        style: 'display: none; margin-left: 24px; border-left: 2px solid var(--background-modifier-border); padding-left: 16px; margin-top: 8px;'
      }
    });

    // Add toggle functionality
    let isExpanded = false;
    textFilteringHeader.addEventListener('click', () => {
      isExpanded = !isExpanded;
      textFilteringContent.style.display = isExpanded ? 'block' : 'none';
      arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
      // arrow.textContent = isExpanded ? '▼ ' : '▶ ';
    });

    // Add information about text filtering to the collapsible content
    const filteringInfo = textFilteringContent.createEl('div', {
      cls: 'edge-tts-info-div'
    });

    const filteringInfoText = document.createElement('p');
    filteringInfoText.style.fontSize = '13px';
    filteringInfoText.style.color = 'var(--text-muted)';
    filteringInfoText.innerHTML = `
      <strong>Text filtering</strong> controls what content is removed from your notes before generating speech. 
      This helps ensure clean, readable narration by filtering out formatting elements that don't translate well to speech.
    `;
    filteringInfo.appendChild(filteringInfoText);

    // Core filtering options
    new Setting(textFilteringContent)
      .setName('Filter frontmatter')
      .setDesc('Remove YAML frontmatter (metadata between --- delimiters) from the beginning of notes.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterFrontmatter);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterFrontmatter = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Filter markdown links')
      .setDesc('Remove markdown links [text](url) completely. When enabled, both the link text and URL are removed.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterMarkdownLinks);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterMarkdownLinks = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Filter wiki links')
      .setDesc('Remove Obsidian wiki-style links [[link]] and keep only the display text.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterWikiLinks);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterWikiLinks = value;
          await this.plugin.saveSettings();
        });
      });

    // Code filtering options
    new Setting(textFilteringContent)
      .setName('Filter code blocks')
      .setDesc('Remove fenced code blocks (```code```) completely.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterCodeBlocks);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterCodeBlocks = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Filter inline code')
      .setDesc('Remove backtick markers from inline code (`code`) while keeping the code text.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterInlineCode);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterInlineCode = value;
          await this.plugin.saveSettings();
        });
      });

    // Content filtering options
    new Setting(textFilteringContent)
      .setName('Filter tables')
      .setDesc('Remove markdown tables completely.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterTables);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterTables = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Filter images')
      .setDesc('Remove image embeds ![alt](url) and attachments ![[image.png]].')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterImages);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterImages = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Filter callouts')
      .setDesc('Remove Obsidian callout blocks (> [!note], > [!warning], etc.) while keeping the content.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterCallouts);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterCallouts = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Filter highlights')
      .setDesc('Remove highlight markers ==text== while keeping the highlighted text.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterHighlights);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterHighlights = value;
          await this.plugin.saveSettings();
        });
      });

    // Advanced filtering options
    new Setting(textFilteringContent)
      .setName('Filter footnotes')
      .setDesc('Remove footnote references [^1] and footnote definitions.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterFootnotes);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterFootnotes = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Filter comments')
      .setDesc('Remove HTML comments <!-- comment --> and Obsidian comments %%comment%%.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterComments);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterComments = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Filter math expressions')
      .setDesc('Remove LaTeX math expressions ($inline$ and $$block$$).')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterMathExpressions);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterMathExpressions = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Filter HTML tags')
      .setDesc('Remove HTML tags while preserving the text content.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.filterHtmlTags);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.filterHtmlTags = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(textFilteringContent)
      .setName('Replace comparison symbols')
      .setDesc('Replace < and > symbols with words to prevent XML parsing issues with multiple symbols on the same line. Language and text can be customized in Symbol Replacement section below.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.textFiltering.replaceComparisonSymbols);
        toggle.onChange(async (value) => {
          this.plugin.settings.textFiltering.replaceComparisonSymbols = value;
          await this.plugin.saveSettings();
        });
      });


    // Create collapsible symbol replacement section
    const symbolReplacementHeader = containerEl.createEl('div', {
      cls: 'setting-item setting-item-heading edge-tts-collapsible-header',
      attr: { style: 'cursor: pointer; user-select: none;' }
    });

    const symbolReplacementTitle = symbolReplacementHeader.createEl('div', { cls: 'setting-item-info' });
    const symbolTitleContainer = symbolReplacementTitle.createEl('div', { cls: 'setting-item-name' });

    // Add arrow icon and title
    const symbolArrow = symbolTitleContainer.createEl('span', {
      text: '▶ ',
      attr: { style: 'display: inline-block; transition: transform 0.2s ease; margin-right: 8px;' }
    });
    symbolTitleContainer.createSpan({ text: 'Symbol replacement' });

    // Add description
    symbolReplacementTitle.createEl('div', {
      cls: 'setting-item-description',
      text: 'Configure how comparison symbols are replaced with words in different languages. Click to expand options.'
    });

    // Create collapsible content container
    const symbolReplacementContent = containerEl.createEl('div', {
      attr: {
        style: 'display: none; margin-left: 24px; border-left: 2px solid var(--background-modifier-border); padding-left: 16px; margin-top: 8px;'
      }
    });

    // Add toggle functionality
    let isSymbolExpanded = false;
    symbolReplacementHeader.addEventListener('click', () => {
      isSymbolExpanded = !isSymbolExpanded;
      symbolReplacementContent.style.display = isSymbolExpanded ? 'block' : 'none';
      symbolArrow.style.transform = isSymbolExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    });

    // Add information about symbol replacement
    const symbolInfo = symbolReplacementContent.createEl('div', {
      cls: 'edge-tts-info-div'
    });

    const symbolInfoText = document.createElement('p');
    symbolInfoText.style.fontSize = '13px';
    symbolInfoText.style.color = 'var(--text-muted)';
    symbolInfoText.innerHTML = `
      <strong>Symbol replacement</strong> converts comparison symbols like &gt; and &lt; into words 
      to prevent XML parsing issues in TTS generation. You can choose from built-in languages or 
      create custom replacements.
    `;
    symbolInfo.appendChild(symbolInfoText);

    // Language selection setting
    new Setting(symbolReplacementContent)
      .setName('Language')
      .setDesc('Choose the language for symbol replacement words. "Auto" detects from your Obsidian interface language, with browser locale as fallback.')
      .addDropdown(dropdown => {
        dropdown.addOption('auto', 'Auto-detect');
        dropdown.addOption('en', 'English');
        dropdown.addOption('es', 'Español');
        dropdown.addOption('fr', 'Français');
        dropdown.addOption('de', 'Deutsch');
        dropdown.addOption('it', 'Italiano');
        dropdown.addOption('pt', 'Português');
        dropdown.addOption('ru', 'Русский');
        dropdown.addOption('ja', '日本語');
        dropdown.addOption('ko', '한국어');
        dropdown.addOption('zh', '中文');

        dropdown.setValue(this.plugin.settings.symbolReplacement.language);
        dropdown.onChange(async (value) => {
          this.plugin.settings.symbolReplacement.language = value;
          await this.plugin.saveSettings();

          // Update custom replacement fields with language defaults when changing language
          if (!this.plugin.settings.symbolReplacement.enableCustomReplacements && value !== 'custom') {
            this.display(); // Refresh settings to show new defaults
          }
        });
      });

    // Enable custom replacements toggle
    new Setting(symbolReplacementContent)
      .setName('Use custom replacements')
      .setDesc('Enable to define your own replacement text instead of using built-in language translations.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.symbolReplacement.enableCustomReplacements);
        toggle.onChange(async (value) => {
          this.plugin.settings.symbolReplacement.enableCustomReplacements = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide custom text fields
        });
      });

    // Show custom replacement fields only if enabled
    if (this.plugin.settings.symbolReplacement.enableCustomReplacements) {
      new Setting(symbolReplacementContent)
        .setName('Greater than (>)')
        .setDesc('Text to replace ">" symbols with (e.g., " greater than ", " maior que ")')
        .addText(text => {
          text.setPlaceholder(' greater than ')
            .setValue(this.plugin.settings.symbolReplacement.customReplacements.greaterThan)
            .onChange(async (value) => {
              this.plugin.settings.symbolReplacement.customReplacements.greaterThan = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(symbolReplacementContent)
        .setName('Less than (<)')
        .setDesc('Text to replace "<" symbols with (e.g., " less than ", " menor que ")')
        .addText(text => {
          text.setPlaceholder(' less than ')
            .setValue(this.plugin.settings.symbolReplacement.customReplacements.lessThan)
            .onChange(async (value) => {
              this.plugin.settings.symbolReplacement.customReplacements.lessThan = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(symbolReplacementContent)
        .setName('Greater than or equal (>=)')
        .setDesc('Text to replace ">=" symbols with (e.g., " greater than or equal to ")')
        .addText(text => {
          text.setPlaceholder(' greater than or equal to ')
            .setValue(this.plugin.settings.symbolReplacement.customReplacements.greaterThanOrEqual)
            .onChange(async (value) => {
              this.plugin.settings.symbolReplacement.customReplacements.greaterThanOrEqual = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(symbolReplacementContent)
        .setName('Less than or equal (<=)')
        .setDesc('Text to replace "<=" symbols with (e.g., " less than or equal to ")')
        .addText(text => {
          text.setPlaceholder(' less than or equal to ')
            .setValue(this.plugin.settings.symbolReplacement.customReplacements.lessThanOrEqual)
            .onChange(async (value) => {
              this.plugin.settings.symbolReplacement.customReplacements.lessThanOrEqual = value;
              await this.plugin.saveSettings();
            });
        });
    } else {
      // Show current language translations as read-only info
      let currentLang = this.plugin.settings.symbolReplacement.language;
      if (currentLang === 'auto') {
        currentLang = detectUserLanguage();
      }

      const translations = COMPARISON_SYMBOL_TRANSLATIONS[currentLang as keyof typeof COMPARISON_SYMBOL_TRANSLATIONS] || COMPARISON_SYMBOL_TRANSLATIONS.en;

      const previewSetting = new Setting(symbolReplacementContent)
        .setName('Current translations')
        .setDesc(`Preview of how symbols will be replaced in ${currentLang === 'auto' ? 'auto-detected' : currentLang} language:`);

      const previewDiv = previewSetting.settingEl.createEl('div', {
        attr: { style: 'margin-top: 8px; padding: 8px; background-color: var(--background-secondary); border-radius: 4px; font-family: monospace; font-size: 12px;' }
      });

      previewDiv.innerHTML = `
        <div>></span> → "<strong>${translations.greaterThan.trim()}</strong>"</div>
        <div>&lt; → "<strong>${translations.lessThan.trim()}</strong>"</div>
        <div>>= → "<strong>${translations.greaterThanOrEqual.trim()}</strong>"</div>
        <div>&lt;= → "<strong>${translations.lessThanOrEqual.trim()}</strong>"</div>
      `;
    }

    containerEl.createEl('h3', { text: 'Extra settings' });

    // Legacy ampersand escaping setting removed - edge-tts-universal handles XML escaping internally

    new Setting(containerEl)
      .setName('Chunk size for long notes')
      .setDesc('Maximum characters per chunk when generating MP3 for long notes. Smaller chunks may be more reliable but take longer. Default: 9000')
      .addSlider(slider => {
        slider.setLimits(5000, 15000, 1000);
        slider.setValue(this.plugin.settings.chunkSize);
        slider.onChange(async (value) => {
          this.plugin.settings.chunkSize = value;
          await this.plugin.saveSettings();
        });
        slider.setDynamicTooltip();
        slider.showTooltip();
      });
  }
} 