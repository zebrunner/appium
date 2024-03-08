/*******************************************************************************
 * Copyright 2018-2021 Zebrunner (https://zebrunner.com/).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *******************************************************************************/
package com.zebrunner.mcloud.grid.agent;

import com.zebrunner.mcloud.grid.agent.validator.DeviceNameValidator;
import com.zebrunner.mcloud.grid.agent.validator.DeviceTypeValidator;
import com.zebrunner.mcloud.grid.agent.validator.MobilePlatformValidator;
import com.zebrunner.mcloud.grid.agent.validator.PlatformVersionValidator;
import com.zebrunner.mcloud.grid.agent.validator.UDIDValidator;
import com.zebrunner.mcloud.grid.agent.validator.Validator;
import org.openqa.selenium.Capabilities;
import org.openqa.selenium.grid.data.DefaultSlotMatcher;
import org.openqa.selenium.remote.CapabilityType;

import java.util.List;
import java.util.logging.Logger;

import static com.zebrunner.mcloud.grid.agent.util.CapabilityUtils.getAppiumCapability;

@SuppressWarnings("unused")
public final class MobileCapabilityMatcher extends DefaultSlotMatcher {
    private static final Logger LOGGER = Logger.getLogger(MobileCapabilityMatcher.class.getName());
    private final List<Validator> validators = List.of(
            new MobilePlatformValidator(),
            new PlatformVersionValidator(),
            new DeviceNameValidator(),
            new DeviceTypeValidator(),
            new UDIDValidator());

    @Override
    public boolean matches(Capabilities stereotype, Capabilities capabilities) {
        LOGGER.info(() -> "Requested capabilities: " + capabilities);
        LOGGER.info(() -> "Stereotype capabilities: " + stereotype);
        if (capabilities.getCapability(CapabilityType.PLATFORM_NAME) != null ||
                getAppiumCapability(capabilities, "platformVersion", Object.class) != null ||
                getAppiumCapability(capabilities, "deviceName", Object.class) != null ||
                getAppiumCapability(capabilities, "udid", Object.class) != null) {
            // Mobile-based capabilities
            LOGGER.info("Using extensionCapabilityCheck matcher.");
            return extensionCapabilityCheck(stereotype, capabilities);
        } else {
            // Browser-based capabilities
            LOGGER.info("Using default browser-based capabilities matcher.");
            return super.matches(stereotype, capabilities);
        }
    }

    /**
     * Verifies matching between requested and actual node capabilities.
     *
     * @param stereotype   node capabilities
     * @param capabilities capabilities requested by client
     * @return match results
     */
    private boolean extensionCapabilityCheck(Capabilities stereotype, Capabilities capabilities) {
        if (stereotype == null) {
            LOGGER.info("stereotype - NULL");
        }
        if (capabilities == null) {
            LOGGER.info("capabilities - NULL");
        }
        boolean matches = stereotype != null &&
                capabilities != null &&
                validators.stream()
                        .allMatch(v -> v.apply(stereotype, capabilities));
        LOGGER.info(() -> "[MATCHES]" + matches);
        return matches;
    }
}
