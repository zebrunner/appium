package com.zebrunner.mcloud.grid.agent;

import com.zebrunner.mcloud.grid.agent.stf.entity.Devices;
import com.zebrunner.mcloud.grid.agent.stf.entity.Path;
import com.zebrunner.mcloud.grid.agent.stf.entity.STFDevice;
import com.zebrunner.mcloud.grid.agent.stf.entity.User;
import com.zebrunner.mcloud.grid.agent.util.HttpClient;
import net.bytebuddy.implementation.bind.annotation.RuntimeType;
import net.bytebuddy.implementation.bind.annotation.SuperCall;
import net.bytebuddy.implementation.bind.annotation.This;
import org.apache.commons.lang3.StringUtils;
import org.openqa.selenium.grid.node.local.SessionSlot;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

import static com.zebrunner.mcloud.grid.agent.SessionSlotReleaseInterceptor.DISCONNECT;

public class SessionSlotReserveInterceptor {

    private static final Logger LOGGER = Logger.getLogger(SessionSlotReserveInterceptor.class.getName());
    private static final String NOT_AUTHENTICATED_ERROR = "[STF] Not authenticated at STF successfully! URL: '%s'; Token: '%s'";
    private static final String UNABLE_GET_DEVICES_STATUS_ERROR = "[STF] Unable to get devices status. HTTP status: %s";
    private static final String COULD_NOT_FIND_DEVICE_ERROR = "[STF] Could not find STF device with udid: %s";
    private static final String STF_URL = System.getenv("STF_URL");
    private static final String DEFAULT_STF_TOKEN = System.getenv("STF_TOKEN");
    private static final boolean STF_ENABLED = (!StringUtils.isEmpty(STF_URL) && !StringUtils.isEmpty(DEFAULT_STF_TOKEN));
    // Max time is seconds for reserving devices in STF
    private static final String DEFAULT_STF_TIMEOUT = Optional.ofNullable(System.getenv("STF_TIMEOUT"))
            .filter(StringUtils::isNotBlank)
            .orElse("3600");
    private static final String UDID = System.getenv("DEVICE_UDID");

    @RuntimeType
    public static void onTestMethodInvocation(@This final SessionSlot slot, @SuperCall final Runnable proxy) throws Exception {
        try {
            if (STF_ENABLED) {
                //                String stfToken = CapabilityUtils.getZebrunnerCapability(slot, "STF_TOKEN")
                //                        .map(String::valueOf)
                //                        .orElse(DEFAULT_STF_TOKEN);
                String stfToken = DEFAULT_STF_TOKEN;

                HttpClient.Response<User> user = HttpClient.uri(Path.STF_USER_PATH, STF_URL)
                        .withAuthorization(buildAuthToken(stfToken))
                        .get(User.class);
                if (user.getStatus() != 200) {
                    LOGGER.warning(() -> String.format(NOT_AUTHENTICATED_ERROR, STF_URL, stfToken));
                    return;
                }
                HttpClient.Response<Devices> devices = HttpClient.uri(Path.STF_DEVICES_PATH, STF_URL)
                        .withAuthorization(buildAuthToken(stfToken))
                        .get(Devices.class);

                if (devices.getStatus() != 200) {
                    LOGGER.warning(() -> String.format(UNABLE_GET_DEVICES_STATUS_ERROR, devices.getStatus()));
                    return;
                }

                Optional<STFDevice> optionalSTFDevice = devices.getObject()
                        .getDevices()
                        .stream()
                        .filter(device -> StringUtils.equals(device.getSerial(), UDID))
                        .findFirst();
                if (optionalSTFDevice.isEmpty()) {
                    LOGGER.warning(() -> String.format(COULD_NOT_FIND_DEVICE_ERROR, UDID));
                    return;
                }

                STFDevice device = optionalSTFDevice.get();
                LOGGER.info(() -> String.format("[STF] STF device info: %s", device));

                boolean reserve = true;

                if (device.getOwner() != null) {
                    if (!(StringUtils.equals(device.getOwner().getName(), user.getObject().getUser().getName()) &&
                            device.getPresent() &&
                            device.getReady())) {
                        LOGGER.warning(() -> String.format("[STF] STF device busy by %s or not present/ready.", device.getOwner().getName()));
                        return;
                    } else if (!StringUtils.equals(stfToken, DEFAULT_STF_TOKEN)) {
                        DISCONNECT.set(false);
                        LOGGER.info(() -> String.format("[STF] STF device manually reserved by the same user: %s.", device.getOwner().getName()));
                        reserve = false;
                    }
                }
                if (reserve) {
                    Map<String, Object> entity = new HashMap<>();
                    entity.put("serial", UDID);
                    entity.put("timeout",
                            TimeUnit.SECONDS.toMillis(Integer.parseInt(DEFAULT_STF_TIMEOUT)));
                    if (HttpClient.uri(Path.STF_USER_DEVICES_PATH, STF_URL)
                            .withAuthorization(buildAuthToken(stfToken))
                            .post(Void.class, entity).getStatus() != 200) {
                        LOGGER.warning(() -> String.format("[STF] Could not reserve STF device with udid: %s.", UDID));
                    } else {
                        LOGGER.info(() -> "[STF] Device successfully reserved.");
                    }
                }
            }
        } catch (Exception e) {
            LOGGER.warning(() -> String.format("[STF] Could not reserve STF device. Error: %s", e.getMessage()));
        } finally {
            proxy.run();
        }
    }

    private static String buildAuthToken(String authToken) {
        return "Bearer " + authToken;
    }
}
