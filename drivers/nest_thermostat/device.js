'use strict';

const Homey = require('homey');
const NestDevice = require('./../nestDevice');

class NestThermostat extends NestDevice {

	onInit() {
		super.onInit();

		// Set default settings
		if (this.getSetting('eco_override_allow') === null) this.setSettings({ eco_override_allow: false });
		if (this.getSetting('eco_override_by')) this.setSettings({ eco_override_by: 'heat' });

		this.hvacStatusChangedFlowTriggerDevice = new Homey.FlowCardTriggerDevice('hvac_status_changed')
			.register()
			.registerRunListener(args => {
				if (args && args.hasOwnProperty('status')) return Promise.resolve(this.client.hvac_state === args.status);
				return Promise.reject(new Error('invalid arguments and or state provided'));
			});

		this.hvacModeChangedFlowTriggerDevice = new Homey.FlowCardTriggerDevice('hvac_mode_changed')
			.register()
			.registerRunListener(args => {
				if (args && args.hasOwnProperty('mode')) return Promise.resolve(this.client.hvac_mode === args.mode);
				return Promise.reject(new Error('invalid arguments and or state provided'));
			});
	}

	/**
	 * Create client and bind event listeners.
	 * @returns {*}
	 */
	createClient() {

		// Create thermostat
		this.client = Homey.app.nestAccount.createThermostat(this.getData().id);

		// If client construction failed, set device unavailable
		if (!this.client) return this.setUnavailable(Homey.__('removed_externally'));

		// Subscribe to events on data change
		this.client
			.on('target_temperature_c', targetTemperatureC => {
				this.setCapabilityValue('target_temperature', targetTemperatureC);
			})
			.on('ambient_temperature_c', ambientTemperatureC => {
				this.setCapabilityValue('measure_temperature', ambientTemperatureC);
			})
			.on('humidity', humidity => {
				this.setCapabilityValue('measure_humidity', humidity);
			})
			.on('hvac_state', hvacState => {

				// Trigger the hvac_status_changed flow
				this.hvacStatusChangedFlowTriggerDevice.trigger(this)
					.catch(err => {
						if (err) return this.error('Error triggeringDevice:', err);
					});
			})
			.on('hvac_mode', hvacMode => {

				// Trigger the hvac_mode_changed flow
				this.hvacModeChangedFlowTriggerDevice.trigger(this)
					.catch(err => {
						if (err) return this.error('Error triggeringDevice:', err);
					});
			})
			.on('removed', () => {
				this.setUnavailable(Homey.__('removed_externally'));
			});

		// Register capability
		this.registerCapabilityListener('target_temperature', this.onCapabilityTargetTemperature.bind(this));
	}

	/**
	 * This method will be called when the target temperature needs to be changed.
	 * @param temperature
	 * @param options
	 * @returns {Promise}
	 */
	onCapabilityTargetTemperature(temperature, options) {
		this.log('onCapabilityTargetTemperature()', 'temperature:', temperature, 'options:', options);

		// Determine if mode is Eco and if it may be overridden
		if (this.client.hasOwnProperty('hvac_mode') &&
			this.client.hvac_mode === 'eco' &&
			this.getSetting('eco_override_allow') === true &&
			['heat', 'cool', 'heat-cool'].indexOf(this.getSetting('eco_override_by')) >= 0) {

			return new Promise((resolve, reject) => {
				this.client.setHvacMode(this.getSetting('eco_override_by'))
					.then(() =>
						// Override succeeded: re-attempt to set target temperature
						resolve(this.onCapabilityTargetTemperature(temperature))
					)
					.catch(err => {
						// Override failed
						const errOverride = Homey.__('error.hvac_mode_eco_override_failed', { name: this.client.name_long || '' }) + err;
						Homey.app.registerLogItem({ msg: errOverride, timestamp: new Date() });
						return reject(errOverride);
					});
			});
		}
		// Fix temperature range
		temperature = Math.round(temperature * 2) / 2;

		return this.client.setTargetTemperature(temperature)
			.catch(err => {
				this.error('Error setting target temperature', err);
				Homey.app.registerLogItem({ msg: err, timestamp: new Date() });
				throw new Error(err);
			});

	}
}

module.exports = NestThermostat;
