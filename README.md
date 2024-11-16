# Obsidian Edge TTS Plugin 🗣️

<p align="center">
	<a href="https://github.com/travisvn/obsidian-edge-tts">
		<img src="https://img.shields.io/github/stars/travisvn/obsidian-edge-tts?style=social" alt="GitHub stars"></a>
    <img src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%27edge-tts%27%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json" alt="Obsidian downloads">
	<a href="https://github.com/travisvn/obsidian-edge-tts/releases">
		<img src="https://img.shields.io/github/v/release/travisvn/obsidian-edge-tts" alt="GitHub release"></a>
	<a href="https://github.com/travisvn/obsidian-edge-tts/issues">
	  <img src="https://img.shields.io/github/issues/travisvn/obsidian-edge-tts" alt="GitHub issues"></a>
	<img src="https://img.shields.io/github/last-commit/travisvn/obsidian-edge-tts?color=red" alt="GitHub last commit">
	<img src="https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2Ftravisvn%2Fobsidian-edge-tts&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=hits&edge_flat=false" alt="Hits">
</p>

## Overview

The **Obsidian Edge TTS Plugin** is a community plugin for [Obsidian](https://obsidian.md/) that allows you to read your notes aloud using Microsoft's Edge TTS API. It supports a variety of voices and locales, making it an excellent tool for users who want to listen to their notes while multitasking or to improve accessibility.

## Features

- Read selected text or entire notes aloud.
- Choose from a list of top voices or specify a custom voice.
- Adjust playback speed of voice over.
- Toggle optional notices for playback status.
- Listen to voice samples before selecting a voice (via [tts.travisvn.com](https://tts.travisvn.com)).

## Installation

1. Open Obsidian.
2. Go to **Settings** → **Community Plugins**.
3. Search for **Edge TTS**.
4. Click **Install** and then **Enable**.

Alternatively, you can manually download the latest release from [GitHub Releases](https://github.com/travisvn/obsidian-edge-tts/releases).

## Usage

1. Select the text in your note that you want to be read aloud.
2. ~Press the hotkey `Ctrl + R` (or `Cmd + R` on macOS), or~ _(hotkey not enabled by default anymore)_ use the **Read note aloud** command from the command palette.
3. You can also click the ribbon icon (if enabled) to read the current note.
4. ✨ _New_ ✨ Playback button in the status bar — this both starts a narration and then allows you to pause or resume once it's started

## Settings

To access the plugin settings:

1. Go to **Settings** → **Community Plugins** → **Edge TTS**.
2. Configure the following options:
   - **Select voice**: Choose from a list of top voices.
   - **Custom voice**: Manually enter a custom voice.
   - **Playback speed**: Adjust playback speed multiplier.
   - **Show notices**: Toggle notices for playback status and errors.
   - **Show status bar button**: Toggle playback button in status bar.
   - **Voice Samples**: Visit [tts.travisvn.com](https://tts.travisvn.com) to sample available voices.
   
   ![Plugin Settings Screenshot](https://utfs.io/f/MMMHiQ1TQaBoL9dM8ZtESTPZ2dEUjVzlDx8yBibtqOcIs46M)

If you like this project, please [give it a star on GitHub](https://github.com/travisvn/obsidian-edge-tts)!

## Contributing

Contributions are welcome! If you'd like to contribute, please:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/your-feature`).
3. Make your changes.
4. Commit and push your changes (`git commit -am 'Add a new feature'`).
5. Open a pull request.
