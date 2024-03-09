package com.zebrunner.mcloud.grid.agent.validator;

import com.zebrunner.mcloud.grid.agent.util.CapabilityUtils;
import org.apache.commons.lang3.StringUtils;
import org.openqa.selenium.Capabilities;
import org.openqa.selenium.Platform;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.remote.CapabilityType;

import java.lang.invoke.MethodHandles;
import java.util.logging.Logger;

public class MobilePlatformValidator implements Validator {
    private static final Logger LOGGER = Logger.getLogger(MethodHandles.lookup().lookupClass().getName());

    @Override
    public Boolean apply(Capabilities stereotype, Capabilities capabilities) {
        Object requested = capabilities.getCapability(CapabilityType.PLATFORM_NAME);
        if (anything(requested instanceof Platform ? ((Platform) requested).name() : String.valueOf(requested))) {
            return true;
        }
        Object provided = stereotype.getCapability(CapabilityType.PLATFORM_NAME);
        if (provided == null) {
            LOGGER.warning("No 'platformName' capability specified for node.");
            return false;
        }

        if (Platform.IOS.is(extractPlatform(provided)) &&
                StringUtils.equalsIgnoreCase(CapabilityUtils.getZebrunnerCapability(capabilities, "deviceType", String.class), "tvos") &&
                Platform.IOS.is(extractPlatform(stereotype))
        ) {
            return true;
        }

        boolean matches = extractPlatform(provided).is(extractPlatform(requested));
        if (matches) {
            LOGGER.info(
                    () -> String.format("[CAPABILITY-VALIDATOR] Platform matches: %s - %s", extractPlatform(requested), extractPlatform(provided)));
        } else {
            LOGGER.info(() -> String.format("[CAPABILITY-VALIDATOR] Platform does not matches: %s - %s", extractPlatform(requested),
                    extractPlatform(provided)));
        }
        return matches;
    }

    private Platform extractPlatform(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof Platform) {
            return (Platform) o;
        }
        try {
            return Platform.fromString(o.toString());
        } catch (WebDriverException ex) {
            return null;
        }
    }
}
