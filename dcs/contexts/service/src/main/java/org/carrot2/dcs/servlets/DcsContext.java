package org.carrot2.dcs.servlets;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;
import javax.servlet.ServletContext;
import javax.servlet.ServletException;
import org.carrot2.clustering.ClusteringAlgorithm;
import org.carrot2.clustering.ClusteringAlgorithmProvider;
import org.carrot2.dcs.client.ClusterRequest;
import org.carrot2.language.ComponentLoader;
import org.carrot2.language.LanguageComponents;
import org.carrot2.util.ResourceLookup;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

class DcsContext {
  public static final String PARAM_RESOURCES = "resources";
  public static final String PARAM_TEMPLATES = "templates";

  private static String KEY = "_dcs_";
  private static Logger console = LoggerFactory.getLogger("console");

  private final LinkedHashMap<String, LanguageComponents> languages;

  final ObjectMapper om;
  final Map<String, ClusterRequest> templates;
  final LinkedHashMap<String, ClusteringAlgorithmProvider> algorithmSuppliers;
  final LinkedHashMap<String, List<String>> algorithmLanguages;

  private DcsContext(ServletContext servletContext) throws ServletException {
    this.om = new ObjectMapper();
    om.configure(JsonParser.Feature.ALLOW_COMMENTS, true);

    this.algorithmSuppliers =
        StreamSupport.stream(
                ServiceLoader.load(ClusteringAlgorithmProvider.class).spliterator(), false)
            .sorted(Comparator.comparing(v -> v.name()))
            .collect(
                Collectors.toMap(
                    e -> e.name(),
                    e -> e,
                    (k1, k2) -> {
                      throw new IllegalStateException("Duplicate algorithm key: " + k1.name());
                    },
                    LinkedHashMap::new));

    this.templates = processTemplates(om, servletContext);
    this.languages = computeLanguageComponents(servletContext);
    this.algorithmLanguages = computeAlgorithmLanguagePairs(algorithmSuppliers, languages.values());

    console.info(
        "DCS context initialized [algorithms: {}, templates: {}]",
        algorithmSuppliers.keySet(),
        templates.keySet());
  }

  private static LinkedHashMap<String, LanguageComponents> computeLanguageComponents(
      ServletContext servletContext) throws ServletException {
    List<String> languageList =
        LanguageComponents.languages().stream().sorted().collect(Collectors.toList());

    ComponentLoader suppliersLoader;

    String resourcePath = servletContext.getInitParameter(PARAM_RESOURCES);
    if (resourcePath != null && !resourcePath.trim().isEmpty()) {
      if (!resourcePath.endsWith("/")) {
        resourcePath += "/";
      }

      console.debug(
          "Will try to load language resources from context path: {}",
          servletContext.getContextPath() + resourcePath);

      ResourceLookup contextLookup = new ServletContextLookup(servletContext, resourcePath);
      suppliersLoader =
          (language, provider) -> {
            try {
              return provider.load(language, contextLookup);
            } catch (IOException e) {
              console.debug(
                  "Will use default resources for '{}' language components of provider '{}'",
                  language,
                  provider.name());
              return provider.load(language);
            }
          };
    } else {
      suppliersLoader = (language, provider) -> provider.load(language);
    }

    LinkedHashMap<String, LanguageComponents> languages = new LinkedHashMap<>();
    for (String lang : languageList) {
      try {
        languages.put(lang, LanguageComponents.load(lang, suppliersLoader));
      } catch (IOException e) {
        throw new ServletException(
            String.format(
                Locale.ROOT, "Could not load the required resource for language '%s'.", lang),
            e);
      }
    }
    return languages;
  }

  private static LinkedHashMap<String, List<String>> computeAlgorithmLanguagePairs(
      LinkedHashMap<String, ClusteringAlgorithmProvider> algorithmSuppliers,
      Collection<LanguageComponents> languageComponents) {
    LinkedHashMap<String, List<String>> algorithmLanguages = new LinkedHashMap<>();
    for (Map.Entry<String, ClusteringAlgorithmProvider> e : algorithmSuppliers.entrySet()) {
      ClusteringAlgorithm algorithm = e.getValue().get();
      List<String> supportedLanguages =
          languageComponents.stream()
              .filter(lc -> algorithm.supports(lc))
              .map(lc -> lc.language())
              .collect(Collectors.toList());
      algorithmLanguages.put(e.getKey(), supportedLanguages);
      console.debug(
          "Languages supported by algorithm '{}': {}",
          e.getKey(),
          String.join(", ", supportedLanguages));
    }

    return algorithmLanguages;
  }

  public static synchronized DcsContext load(ServletContext servletContext)
      throws ServletException {
    DcsContext context = (DcsContext) servletContext.getAttribute(KEY);
    if (context == null) {
      context = new DcsContext(servletContext);
      servletContext.setAttribute(KEY, context);
    }
    return context;
  }

  private Map<String, ClusterRequest> processTemplates(
      ObjectMapper om, ServletContext servletContext) throws ServletException {
    String templatePath = servletContext.getInitParameter(PARAM_TEMPLATES);
    if (templatePath == null || templatePath.isEmpty()) {
      console.warn("Template path init parameter is empty.");
      return Collections.emptyMap();
    }

    Pattern NAME_PATTERN =
        Pattern.compile(
            "(/)?(?<ordering>[0-9]+)?+(?<separator>\\s*\\-?\\s*)?+(?<id>[^/]+)(.json)$",
            Pattern.CASE_INSENSITIVE);

    Map<String, ClusterRequest> templates = new LinkedHashMap<>();
    Set<String> resourcePaths = servletContext.getResourcePaths(templatePath);
    if (resourcePaths != null) {
      for (TemplateInfo ti :
          resourcePaths.stream()
              .filter(path -> path.toLowerCase(Locale.ROOT).endsWith(".json"))
              .map(path -> new TemplateInfo(path))
              .filter(v -> v != null)
              .sorted(Comparator.comparing(t -> t.name))
              .collect(Collectors.toList())) {
        try {
          ClusterRequest requestTemplate =
              om.readValue(servletContext.getResourceAsStream(ti.path), ClusterRequest.class);
          if (requestTemplate.documents != null && !requestTemplate.documents.isEmpty()) {
            console.warn(
                "Templates must not contain the 'documents' property, clearing it in template: {}",
                ti.path);
            requestTemplate.documents = null;
          }

          if (requestTemplate.algorithm != null
              && !algorithmSuppliers.containsKey(requestTemplate.algorithm)) {
            console.debug(
                "Template '{}' omitted because the algorithm is not available: {}",
                ti.path,
                requestTemplate.algorithm);
          } else {
            templates.put(ti.id, requestTemplate);
          }
        } catch (IOException e) {
          throw new ServletException("Could not process request template: " + ti.path, e);
        }
      }
    }
    return templates;
  }

  public LanguageComponents getLanguage(String requestedLanguage) {
    return languages.get(requestedLanguage);
  }

  private static class TemplateInfo {
    private static Pattern NAME_PATTERN =
        Pattern.compile("(/)?(?<name>[^/]+)(.json)$", Pattern.CASE_INSENSITIVE);
    private static Pattern ID_PATTERN =
        Pattern.compile("^(?:[0-9]+)?+(?:\\s*\\-?\\s*)?+", Pattern.CASE_INSENSITIVE);

    private final String path;
    private final String name;
    private final String id;

    public TemplateInfo(String path) {
      this.path = path;
      Matcher matcher = NAME_PATTERN.matcher(path);
      if (!matcher.find()) {
        throw new RuntimeException("Name part not found?: " + path);
      }
      this.name = matcher.group("name");
      this.id = ID_PATTERN.matcher(name).replaceAll("");
    }
  }
}
