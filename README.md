# Obsidian Edge TTS Plugin 🗣️

<p align="center">
	<a href="https://github.com/travisvn/obsidian-edge-tts">
		<img src="https://img.shields.io/github/stars/travisvn/obsidian-edge-tts?style=social" alt="GitHub stars"></a>
	<a href="https://tts.travisvn.com/obsidian" target="_blank">
    <img src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%27edge-tts%27%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json" alt="Obsidian downloads"></a>
	<a href="https://github.com/travisvn/obsidian-edge-tts/releases">
		<img src="https://img.shields.io/github/v/release/travisvn/obsidian-edge-tts" alt="GitHub release"></a>
	<a href="https://github.com/travisvn/obsidian-edge-tts/issues">
	  <img src="https://img.shields.io/github/issues/travisvn/obsidian-edge-tts" alt="GitHub issues"></a>
	<img src="https://img.shields.io/github/last-commit/travisvn/obsidian-edge-tts?color=red" alt="GitHub last commit">
	<a href="https://discord.gg/GkFbBCBqJ6" target="_blank">
    <img src="https://img.shields.io/badge/Discord-Voice_AI_%26_TTS_Tools-blue?logo=discord&logoColor=white" alt="Discord">
  </a>
</p>

<h1 align="center">Free high-quality text-to-speech (narration) in Obsidian</h1>

## Overview

The **Obsidian Edge TTS Plugin** is a community plugin for [Obsidian](https://obsidian.md/) that allows you to read your notes aloud using Microsoft's Edge TTS API. It supports a variety of voices and locales, making it an excellent tool for users who want to listen to their notes while multitasking or to improve accessibility.

## Features

- Read selected text or entire notes aloud
- Choose from a list of top voices or specify a custom voice
- Adjust playback speed of voice over
- Toggle optional notices for playback status
- Option to generate mp3 file and embed it directly in note
- Listen to voice samples before selecting a voice (via [tts.travisvn.com](https://tts.travisvn.com))

## Installation

[Install Obsidian plugin](https://tts.travisvn.com/obsidian)

1. Open Obsidian
2. Go to **Settings** → **Community Plugins**
3. Search for **Edge TTS**
4. Click **Install** and then **Enable**

Alternatively, you can manually download the latest release from [GitHub Releases](https://github.com/travisvn/obsidian-edge-tts/releases)

## Usage

- Open the note you want to read aloud (or select the text)
- Use the **Read note aloud** command from the command palette
  - _or_ Click the ribbon icon (if enabled)
  - _or_ Playback button in the status bar — this both starts a narration and then allows you to pause or resume once it's started
  - _or_ Right-click on a file and select `Read note aloud`
- Right-click on a file and select `Generate MP3` to save the narration to an mp3 and embed it in the note

## Settings

To access the plugin settings:

1. Go to **Settings** → **Community Plugins** → **Edge TTS**.
2. Configure the following options:

   - **Select voice**: Choose from a list of top voices.
   - **Custom voice**: Manually enter a custom voice.
   - **Playback speed**: Adjust playback speed multiplier.
   - **Show notices**: Toggle notices for playback status and errors.
   - **Show status bar button**: Toggle playback button in status bar.
   - **Generate MP3**: Toggle settings related to the `Generate MP3` menu option.
   - **Voice Samples**: Visit [tts.travisvn.com](https://tts.travisvn.com) to sample available voices.

   ![Obsidian Edge TTS Plugin Settings Screenshot](https://utfs.io/f/MMMHiQ1TQaBoUkXv9BIyF8jY32HKoB45tuela0IdhLQ7JTvc)

<h1 align="center">If you like this project, please <a href="https://github.com/travisvn/obsidian-edge-tts" target="_blank">give it a star on GitHub</a> ⭐️</h1>

## ✨ _New_ Mobile Option 📱

Create audio narration for your Obsidian notes through our free mobile app

<p align="center">
	<a href="https://play.google.com/store/apps/details?id=app.readaloudai" target="_blank">
		<img src="/src/assets/google-play-badge.svg" alt="Get it on Google Play" width="175">
	</a> 
	<a href="https://apps.apple.com/app/id6743985203" target="_blank">
		<img src="/src/assets/app-store-badge.svg" alt="Download on the App Store" width="160">
	</a>
</p>

- Available on **iOS** and **Android**
- Usage:
  - Use the "share" functionality on any given note
  - Select `Read Aloud AI` from the native mobile share menu
  - Your markdown will be imported from the shared file and formatted like in the Obsidian desktop plugin
  - Narration will playback instantly, and you can export the `.mp3` generated back into Obsidian
 

