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
package com.zebrunner.mcloud.grid.agent.util;

import com.sun.jersey.api.client.Client;
import com.sun.jersey.api.client.ClientResponse;
import com.sun.jersey.api.client.WebResource;
import com.sun.jersey.api.client.config.DefaultClientConfig;
import com.sun.jersey.core.util.MultivaluedMapImpl;
import com.zebrunner.mcloud.grid.agent.stf.entity.Path;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.concurrent.ConcurrentException;
import org.apache.commons.lang3.concurrent.LazyInitializer;
import org.apache.commons.lang3.exception.ExceptionUtils;

import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.MultivaluedMap;
import java.util.Map;
import java.util.function.Function;
import java.util.logging.Level;
import java.util.logging.Logger;

public final class HttpClient {
    private static final Logger LOGGER = Logger.getLogger(HttpClient.class.getName());

    private static final LazyInitializer<Client> CLIENT = new LazyInitializer<>() {
        @Override
        protected Client initialize() throws ConcurrentException {
            Client client = Client.create(new DefaultClientConfig(GensonProvider.class));
            client.setConnectTimeout(3000);
            client.setReadTimeout(3000);
            return client;
        }
    };

    private HttpClient() {
        //hide
    }

    public static Executor uri(Path path, String serviceUrl, Object... parameters) {
        String url = path.build(serviceUrl, parameters);
        return uri(url, null);
    }

    public static Executor uri(Path path, Map<String, String> queryParameters, String serviceUrl, Object... parameters) {
        String url = path.build(serviceUrl, parameters);
        return uri(url, queryParameters);
    }

    private static Executor uri(String url, Map<String, String> queryParameters) {
        try {
            WebResource webResource = CLIENT.get()
                    .resource(url);
            if (queryParameters != null) {
                MultivaluedMap<String, String> requestParameters = new MultivaluedMapImpl();
                queryParameters.forEach(requestParameters::add);
                webResource = webResource.queryParams(requestParameters);
            }
            return new Executor(webResource);
        } catch (ConcurrentException e) {
            return ExceptionUtils.rethrow(e);
        }
    }

    public static class Executor {

        private final WebResource.Builder builder;
        private String errorMessage;

        public Executor(WebResource webResource) {
            builder = webResource.type(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON);
        }

        public <R> Response<R> get(Class<R> responseClass) {
            return execute(responseClass, builder -> builder.get(ClientResponse.class));
        }

        public <R> Response<R> post(Class<R> responseClass, Object requestEntity) {
            return execute(responseClass, builder -> builder.post(ClientResponse.class, requestEntity));
        }

        public <R> Response<R> put(Class<R> responseClass, Object requestEntity) {
            return execute(responseClass, builder -> builder.put(ClientResponse.class, requestEntity));
        }

        public <R> Response<R> delete(Class<R> responseClass) {
            return execute(responseClass, builder -> builder.delete(ClientResponse.class));
        }

        public Executor type(String mediaType) {
            builder.type(mediaType);
            return this;
        }

        public Executor accept(String mediaType) {
            builder.accept(mediaType);
            return this;
        }

        public Executor withAuthorization(String authToken) {
            return withAuthorization(authToken, null);
        }

        public Executor withAuthorization(String authToken, String project) {
            initHeaders(builder, authToken, project);
            return this;
        }

        private static void initHeaders(WebResource.Builder builder, String authToken, String project) {
            if (!StringUtils.isEmpty(authToken)) {
                builder.header("Authorization", authToken);
            }
            if (!StringUtils.isEmpty(project)) {
                builder.header("Project", project);
            }
        }

        private <R> Response<R> execute(Class<R> responseClass, Function<WebResource.Builder, ClientResponse> methodBuilder) {
            Response<R> rs = new Response<>();
            try {
                ClientResponse response = methodBuilder.apply(builder);
                int status = response.getStatus();
                rs.setStatus(status);
                if (responseClass != null && !responseClass.isAssignableFrom(Void.class) && status == 200) {
                    rs.setObject(response.getEntity(responseClass));
                }
            } catch (Exception e) {
                String message = errorMessage == null ? e.getMessage() : e.getMessage() + ". " + errorMessage;
                LOGGER.log(Level.SEVERE, message, e);
            }
            return rs;
        }

        public Executor onFailure(String message) {
            this.errorMessage = message;
            return this;
        }

    }

    public static class Response<T> {

        private int status;
        private T object;

        public Response() {
        }

        Response(int status, T object) {
            this.status = status;
            this.object = object;
        }

        public int getStatus() {
            return status;
        }

        public void setStatus(int status) {
            this.status = status;
        }

        public T getObject() {
            return object;
        }

        public void setObject(T object) {
            this.object = object;
        }

        @Override
        public String toString() {
            return "Response [status=" + status + ", object=" + object + "]";
        }
    }
}
