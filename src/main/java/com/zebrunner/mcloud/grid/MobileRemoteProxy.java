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
package com.zebrunner.mcloud.grid;

import com.zebrunner.mcloud.grid.integration.client.Path;
import com.zebrunner.mcloud.grid.util.CapabilityUtils;
import com.zebrunner.mcloud.grid.util.HttpClient;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.exception.ExceptionUtils;
import org.apache.commons.lang3.reflect.FieldUtils;
import org.openqa.selenium.Capabilities;
import org.openqa.selenium.NoSuchSessionException;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.grid.config.Config;
import org.openqa.selenium.grid.data.CreateSessionRequest;
import org.openqa.selenium.grid.data.CreateSessionResponse;
import org.openqa.selenium.grid.data.NodeId;
import org.openqa.selenium.grid.data.NodeStatus;
import org.openqa.selenium.grid.data.Session;
import org.openqa.selenium.grid.log.LoggingOptions;
import org.openqa.selenium.grid.node.HealthCheck;
import org.openqa.selenium.grid.node.Node;
import org.openqa.selenium.grid.node.local.LocalNode;
import org.openqa.selenium.grid.node.local.LocalNodeFactory;
import org.openqa.selenium.grid.node.local.SessionSlot;
import org.openqa.selenium.grid.security.Secret;
import org.openqa.selenium.grid.security.SecretOptions;
import org.openqa.selenium.grid.server.BaseServerOptions;
import org.openqa.selenium.internal.Either;
import org.openqa.selenium.io.TemporaryFilesystem;
import org.openqa.selenium.remote.SessionId;
import org.openqa.selenium.remote.http.HttpMethod;
import org.openqa.selenium.remote.http.HttpRequest;
import org.openqa.selenium.remote.http.HttpResponse;
import org.openqa.selenium.remote.tracing.Tracer;

import java.io.IOException;
import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

public class MobileRemoteProxy extends Node {
    private static final Logger LOGGER = Logger.getLogger(MobileRemoteProxy.class.getName());
    private static final String NOT_AUTHENTICATED_ERROR = "[STF] Not authenticated at STF successfully! URL: '%s'; Token: '%s'";
    private static final String UNABLE_GET_DEVICES_STATUS_ERROR = "[STF] Unable to get devices status. HTTP status: %s";
    private static final String COULD_NOT_FIND_DEVICE_ERROR = "[STF] Could not find STF device with udid: %s";
    private static final String STF_URL = System.getenv("STF_URL");
    private static final String DEFAULT_STF_TOKEN = System.getenv("STF_TOKEN");
    // Max time is seconds for reserving devices in STF
    private static final String DEFAULT_STF_TIMEOUT = Optional.ofNullable(System.getenv("STF_TIMEOUT"))
            .filter(StringUtils::isNotBlank)
            .orElse("3600");

    private LocalNode node;
    private Capabilities stereotype;
    private String udid;

    protected MobileRemoteProxy(Tracer tracer, URI uri, Secret registrationSecret) {
        super(tracer, new NodeId(UUID.randomUUID()), uri, registrationSecret);
    }

    @SuppressWarnings("unchecked")
    public static Node create(Config config) {
        LoggingOptions loggingOptions = new LoggingOptions(config);
        BaseServerOptions serverOptions = new BaseServerOptions(config);
        URI uri = serverOptions.getExternalUri();
        SecretOptions secretOptions = new SecretOptions(config);

        // Refer to the foot notes for additional context on this line.
        Node node = LocalNodeFactory.create(config);

        MobileRemoteProxy wrapper = new MobileRemoteProxy(loggingOptions.getTracer(), uri, secretOptions.getRegistrationSecret());
        wrapper.node = (LocalNode) node;
        try {
            wrapper.stereotype = ((List<SessionSlot>) FieldUtils.readField(node, "factories", true)).get(0)
                    .getStereotype();
        } catch (IllegalAccessException e) {
            return ExceptionUtils.rethrow(e);
        }
        wrapper.udid = String.valueOf(CapabilityUtils.getAppiumCapability(wrapper.stereotype, "udid").orElseThrow());
        return wrapper;
    }

    @Override
    public Either<WebDriverException, CreateSessionResponse> newSession(CreateSessionRequest sessionRequest) {
        /*
        if (isSTFEnabled()) {
            HttpClient.Response<User> user = HttpClient.uri(Path.STF_USER_PATH, STF_URL)
                    .withAuthorization(buildAuthToken(stfToken))
                    .get(User.class);
            if (user.getStatus() != 200) {
                LOGGER.warning(() ->
                        String.format(NOT_AUTHENTICATED_ERROR, STF_URL, stfToken));
                return Either.left(
                        new RetrySessionRequestException(String.format(NOT_AUTHENTICATED_ERROR, STF_URL, stfToken)));
            }
            HttpClient.Response<Devices> devices = HttpClient.uri(Path.STF_DEVICES_PATH, STF_URL)
                    .withAuthorization(buildAuthToken(stfToken))
                    .get(Devices.class);

            if (devices.getStatus() != 200) {
                LOGGER.warning(() -> String.format(UNABLE_GET_DEVICES_STATUS_ERROR, devices.getStatus()));
                return Either.left(
                        new RetrySessionRequestException(String.format(UNABLE_GET_DEVICES_STATUS_ERROR, devices.getStatus())));
            }

            Optional<STFDevice> optionalSTFDevice = devices.getObject()
                    .getDevices()
                    .stream()
                    .filter(device -> StringUtils.equals(device.getSerial(), udid))
                    .findFirst();
            if (optionalSTFDevice.isEmpty()) {
                LOGGER.warning(() -> String.format(COULD_NOT_FIND_DEVICE_ERROR, udid));
                return Either.left(
                        new RetrySessionRequestException(String.format(COULD_NOT_FIND_DEVICE_ERROR, udid)));
            }

            STFDevice device = optionalSTFDevice.get();
            LOGGER.info(() -> String.format("STF device info: %s", device));

            if (device.getOwner() != null) {
                if (!(StringUtils.equals(device.getOwner().getName(), user.getObject().getUser().getName()) &&
                        device.getPresent() &&
                        device.getReady())) {
                    return Either.left(new RetrySessionRequestException(
                            String.format("STF device busy by %s or not present/ready.", device.getOwner().getName())));
                }
            }
        }
        */

        Either<WebDriverException, CreateSessionResponse> response = node.newSession(sessionRequest);
        if (response.isRight() && isSTFEnabled()) {
            String stfToken = CapabilityUtils.getZebrunnerCapability(sessionRequest.getDesiredCapabilities(), "STF_TOKEN")
                    .map(String::valueOf)
                    .orElse(DEFAULT_STF_TOKEN);
            Map<String, Object> entity = new HashMap<>();
            entity.put("serial", udid);
            entity.put("timeout",
                    TimeUnit.SECONDS.toMillis(CapabilityUtils.getZebrunnerCapability(sessionRequest.getDesiredCapabilities(), "STF_TIMEOUT")
                            .map(String::valueOf)
                            .map(Integer::parseInt)
                            .orElse(Integer.parseInt(DEFAULT_STF_TIMEOUT))));
            if (HttpClient.uri(Path.STF_USER_DEVICES_PATH, STF_URL)
                    .withAuthorization(buildAuthToken(stfToken))
                    .post(Void.class, entity).getStatus() != 200) {
                LOGGER.warning(() -> String.format("[STF] Could not reserve STF device with udid: %s.", udid));
            }
        }
        return response;
    }

    @Override
    public HttpResponse executeWebDriverCommand(HttpRequest req) {
        if (HttpMethod.DELETE.equals(req.getMethod())) {
            if (isSTFEnabled()) {
                LOGGER.info(() -> "[STF] Return STF Device.");
                if (HttpClient.uri(Path.STF_USER_DEVICES_BY_ID_PATH, STF_URL, udid)
                        .withAuthorization(buildAuthToken(DEFAULT_STF_TOKEN))
                        .delete(Void.class).getStatus() != 200) {
                    LOGGER.warning(() -> "[STF] Could not return device to the STF.");
                }
            }
        }
        return node.executeWebDriverCommand(req);
    }

    @Override
    public Session getSession(SessionId id) throws NoSuchSessionException {
        return node.getSession(id);
    }

    @Override
    public HttpResponse uploadFile(HttpRequest req, SessionId id) {
        return node.uploadFile(req, id);
    }

    @Override
    public HttpResponse downloadFile(HttpRequest req, SessionId id) {
        return node.downloadFile(req, id);
    }

    @Override
    public TemporaryFilesystem getDownloadsFilesystem(UUID uuid) throws IOException {
        return node.getDownloadsFilesystem(uuid);
    }

    @Override
    public TemporaryFilesystem getUploadsFilesystem(SessionId id) throws IOException {
        return node.getUploadsFilesystem(id);
    }

    @Override
    public void stop(SessionId id) throws NoSuchSessionException {
        if (isSTFEnabled()) {
            LOGGER.info(() -> "[STF] Return STF Device.");
            if (HttpClient.uri(Path.STF_USER_DEVICES_BY_ID_PATH, STF_URL, udid)
                    .withAuthorization(buildAuthToken(DEFAULT_STF_TOKEN))
                    .delete(Void.class).getStatus() != 200) {
                LOGGER.warning(() -> "[STF] Could not return device to the STF.");
            }
        }
        node.stop(id);
    }

    @Override
    public boolean isSessionOwner(SessionId id) {
        return node.isSessionOwner(id);
    }

    @Override
    public boolean isSupporting(Capabilities capabilities) {
        return node.isSupporting(capabilities);
    }

    @Override
    public NodeStatus getStatus() {
        return node.getStatus();
    }

    @Override
    public HealthCheck getHealthCheck() {
        return node.getHealthCheck();
    }

    @Override
    public void drain() {
        node.drain();
    }

    @Override
    public boolean isReady() {
        return node.isReady();
    }

    private static boolean isSTFEnabled() {
        return (!StringUtils.isEmpty(STF_URL) && !StringUtils.isEmpty(DEFAULT_STF_TOKEN));
    }

    private static String buildAuthToken(String authToken) {
        return "Bearer " + authToken;
    }
}
