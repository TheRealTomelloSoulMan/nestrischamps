const BinaryFrame = require('../public/js/BinaryFrame');
const ScoreDAO = require('../daos/ScoreDAO');
const got = require('got');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');

class Replay {
	constructor(connection, player_num, game_id_or_url, time_scale = 1) {
		this.connection = connection;
		this.player_num = player_num;
		this.game_id_or_url = game_id_or_url;
		this.time_scale = time_scale;
		this.frame_buffer = [];
		this.frame_size = 0;

		this.startStreaming();
	}

	async startStreaming() {
		if (typeof this.game_id_or_url === 'string') {
			if (this.game_id_or_url.startsWith('http')) {
				const game_url = this.game_id_or_url;
				this.game_stream = got.stream(game_url);
			} else {
				console.log(`Replay Error: Invalid Game URL: this.game_id_or_url`);
				return;
			}
		} else {
			const game_id = this.game_id_or_url;
			const score_data = await ScoreDAO.getAnonymousScore(game_id);
			const file_path = score_data.frame_file;

			if (!file_path) {
				console.log(
					`Replay Error: No replay file found for gameid ${game_id}:`,
					score_data
				);
				return;
			}

			if (process.env.GAME_FRAMES_BUCKET) {
				// data comes from S3
				//https://nestrischamps.s3-us-west-1.amazonaws.com/
				const base_url = `https://${process.env.GAME_FRAMES_BUCKET}.s3-${process.env.GAME_FRAMES_REGION}.amazonaws.com/`;

				this.game_stream = got.stream(`${base_url}${file_path}`);
			} else {
				// data comes from local file
				this.game_stream = fs
					.createReadStream(path.join(__dirname, '..', file_path))
					.pipe(zlib.createGunzip());
			}
		}

		this.game_stream.on('readable', () => {
			/* eslint-disable no-constant-condition */
			do {
				if (!this.frame_size) {
					const buf = this.game_stream.read(1);

					if (buf === null) {
						// shouldn't happen but 🤷
						// is this a memory leak? 🤔
						return;
					}

					const b = new Uint8Array(buf);
					const version = b[0] >> 5 || 1;

					if (BinaryFrame.FRAME_SIZE_BY_VERSION[version]) {
						this.frame_size = BinaryFrame.FRAME_SIZE_BY_VERSION[version];
						this.game_stream.unshift(buf);
						break;
					} else {
						// unknown version, do nothing
						// is this a memory leak? 🤔
						return;
					}
				}

				const buf = this.game_stream.read(this.frame_size);

				if (buf.length < this.frame_size) {
					this.game_stream.unshift(buf);
					break;
				}

				if (!this.start_time) {
					// Parsing the frame may not be needed just to get ctime
					// but we should also check the version format

					const data = BinaryFrame.parse(buf);

					this.start_time = Date.now();
					this.start_ctime = data.ctime;
				}

				this.frame_buffer.push(buf);

				this.sendNextFrame();
			} while (true);

			this.game_stream.read(0);
		});

		// TODO: Error handling close hand,ing on source and target, etc...
	}

	sendNextFrame() {
		if (this.send_timeout) return;
		if (this.frame_buffer.length <= 0) return;

		const frame = new Uint8Array(this.frame_buffer.shift());

		frame[0] = (frame[0] & 0b11111000) | this.player_num;

		const tdiff = Math.round(
			(BinaryFrame.getCTime(frame) - this.start_ctime) / this.time_scale
		);
		const frame_tick = this.start_time + tdiff;
		const now = Date.now();

		const send_delay = Math.max(0, frame_tick - now);

		this.send_timeout = setTimeout(() => {
			this.send_timeout = null;
			this.connection.send(frame);
			this.sendNextFrame();
		}, send_delay);
	}
}

module.exports = Replay;
