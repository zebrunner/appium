package com.zebrunner.mcloud.grid.agent.validator;

import com.zebrunner.mcloud.grid.agent.utils.CapabilityUtils;
import org.apache.commons.lang3.StringUtils;
import org.openqa.selenium.Capabilities;

import java.lang.invoke.MethodHandles;
import java.util.Arrays;
import java.util.Optional;
import java.util.logging.Logger;

public class DeviceNameValidator implements Validator {
    private static final Logger LOGGER = Logger.getLogger(MethodHandles.lookup().lookupClass().getName());
    private static final String DEVICE_NAME_CAPABILITY = "deviceName";

    @Override
    public Boolean apply(Capabilities stereotype, Capabilities capabilities) {
        String expectedValue = CapabilityUtils.getAppiumCapability(capabilities, DEVICE_NAME_CAPABILITY, String.class);
        if (anything(expectedValue)) {
            return true;
        }
        String actualValue = CapabilityUtils.getAppiumCapability(stereotype, DEVICE_NAME_CAPABILITY, String.class);
        if (actualValue == null) {
            LOGGER.warning("No 'deviceName' capability specified for node.");
            return false;
        }
        boolean matches = Arrays.stream(Optional.ofNullable(StringUtils.split(expectedValue, ",")).orElse(new String[] {}))
                .anyMatch(e -> StringUtils.equals(e, actualValue));
        if (matches) {
            LOGGER.info(() -> String.format("[CAPABILITY-VALIDATOR] device name matches: %s - %s", expectedValue, actualValue));
        } else {
            LOGGER.info(() -> String.format("[CAPABILITY-VALIDATOR] device name does not matches: %s - %s", expectedValue, actualValue));
        }
        return matches;
    }
}
